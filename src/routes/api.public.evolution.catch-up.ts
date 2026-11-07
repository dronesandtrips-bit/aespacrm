// POST /api/public/evolution/catch-up
// Recupera automaticamente mensagens que a Evolution (instância `zapcrm`)
// guardou, mas cujo aviso (webhook) se perdeu durante quedas/reconexões.
//
// Segurança e INTEGRIDADE:
//  - Somente LEITURA na Evolution (findMessages). Nunca envia mensagens.
//  - Só grava no CRM mensagens que ainda NÃO existem (ignoreDuplicates) —
//    nunca sobrescreve status/conteúdo de mensagens já salvas.
//  - Exige login do dono da instância (EVOLUTION_OWNER_USER_ID).
//  - Resposta recuperada de cliente pausa sequências ativas (mesma regra do
//    webhook). Agendamento/confirmação automáticos NÃO são acionados aqui,
//    para não agir sobre mensagens atrasadas.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS, requireUserJwt } from "@/integrations/supabase/server";
import { isStrictValidPhone, phoneMatchVariants } from "@/lib/phone-validation";
import { buildLidMap, isGroupChatJid, recoverableRecords, resolveChatJid, unresolvedLids } from "@/lib/evolution-catchup";
import { detectMessageType } from "@/lib/evolution-message-type";

const INSTANCE = "zapcrm";
const PAGE_SIZE = 50;
const MAX_PAGES = 8;
const MAX_LID_LOOKUPS = 5;
const DEFAULT_WINDOW_HOURS = 6;
const MAX_WINDOW_HOURS = 48;

function normalizeUrl(value: string) {
  const t = value.trim();
  return (/^https?:\/\//i.test(t) ? t : `https://${t}`).replace(/\/+$/, "");
}

function extractRecords(j: any): any[] {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.messages?.records)) return j.messages.records;
  if (Array.isArray(j?.records)) return j.records;
  if (Array.isArray(j?.messages)) return j.messages;
  return [];
}

async function findIndividualContact(sb: any, userId: string, phone: string, name: string) {
  const { data: existing } = await sb
    .from("crm_contacts")
    .select("id")
    .eq("user_id", userId)
    .in("phone_norm", phoneMatchVariants(phone))
    .eq("is_group", false)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const safeName = name && !name.includes("@") && !/^\d{14,}$/.test(name) ? name.slice(0, 120) : phone;
  const { data: created, error } = await sb
    .from("crm_contacts")
    .insert({ user_id: userId, name: safeName, phone, is_group: false })
    .select("id")
    .single();
  if (error) {
    const { data: dup } = await sb
      .from("crm_contacts")
      .select("id")
      .eq("user_id", userId)
      .in("phone_norm", phoneMatchVariants(phone))
      .eq("is_group", false)
      .limit(1)
      .maybeSingle();
    return (dup?.id as string) ?? null;
  }
  return created.id as string;
}

async function findGroupContact(sb: any, userId: string, jid: string) {
  const { data: existing } = await sb
    .from("crm_contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("wa_jid", jid)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await sb
    .from("crm_contacts")
    .insert({ user_id: userId, name: "Grupo", phone: jid.split("@")[0].replace(/\D/g, "") || "0", is_group: true, wa_jid: jid })
    .select("id")
    .single();
  return error ? null : (created.id as string);
}

export const Route = createFileRoute("/api/public/evolution/catch-up")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      POST: async ({ request }) => {
        try {
          const apiUrl = process.env.EVOLUTION_API_URL ? normalizeUrl(process.env.EVOLUTION_API_URL) : "";
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
          if (!apiUrl || !apiKey || !ownerUserId) {
            return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
          }

          const auth = await requireUserJwt(request);
          if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
          if (auth.userId !== ownerUserId) {
            return jsonResponse({ ok: false, error: "forbidden" }, 403);
          }

          const body = await request.json().catch(() => null);
          const hoursRaw = Number(body?.hours);
          const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, MAX_WINDOW_HOURS) : DEFAULT_WINDOW_HOURS;
          const sinceSec = Math.floor(Date.now() / 1000 - hours * 3600);

          const evo = async (payload: unknown) => {
            const r = await fetch(`${apiUrl}/chat/findMessages/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!r.ok) throw new Error(`evolution HTTP ${r.status}`);
            return extractRecords(await r.json().catch(() => null));
          };

          // A Evolution devolve no máximo ~50 por página (mais recentes primeiro).
          let raw: any[] = [];
          try {
            for (let page = 1; page <= MAX_PAGES; page++) {
              const batch = await evo({ sort: { messageTimestamp: "desc" }, limit: PAGE_SIZE, page });
              raw = raw.concat(batch);
              const oldest = Math.min(...batch.map((x) => Number(x?.messageTimestamp) || Infinity));
              if (batch.length < PAGE_SIZE || !(oldest >= sinceSec)) break;
            }
          } catch (e: any) {
            return jsonResponse({ ok: false, error: e?.message ?? "evolution error" }, 502);
          }

          // Conversas "@lid" sem número: aprende o número em outras mensagens da mesma conversa.
          const lidMap = buildLidMap(raw);
          for (const lid of unresolvedLids(raw, lidMap).slice(0, MAX_LID_LOOKUPS)) {
            try {
              buildLidMap(await evo({ where: { key: { remoteJid: lid } }, limit: PAGE_SIZE, page: 1 }), lidMap);
            } catch {
              /* segue sem esse número */
            }
          }

          const records = recoverableRecords(raw, sinceSec, lidMap);
          if (!records.length) return jsonResponse({ ok: true, checked: 0, imported: 0, contactIds: [] });

          const sb = getSupabaseAdmin();
          const ids = records.map((x) => String(x.key!.id));
          const have = new Set<string>();
          for (let i = 0; i < ids.length; i += 100) {
            const { data, error } = await sb
              .from("crm_messages")
              .select("message_id")
              .eq("user_id", ownerUserId)
              .in("message_id", ids.slice(i, i + 100));
            if (error) return jsonResponse({ ok: false, error: "db_read_failed", detail: error.message }, 500);
            (data ?? []).forEach((row: any) => have.add(row.message_id));
          }

          const missing = records
            .filter((x) => !have.has(String(x.key!.id)))
            .sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));

          let imported = 0;
          const contactIds = new Set<string>();
          const pausedContacts = new Set<string>();
          for (const msg of missing) {
            const jid = resolveChatJid(msg.key, lidMap);
            const isGroup = isGroupChatJid(jid);
            const fromMe = !!msg.key?.fromMe;
            const pushName = fromMe ? "" : String((msg as any).pushName ?? "");
            let contactId: string | null = null;
            if (isGroup) {
              contactId = await findGroupContact(sb, ownerUserId, jid);
            } else {
              const phone = jid.split("@")[0].replace(/\D/g, "");
              if (!isStrictValidPhone(phone)) continue;
              contactId = await findIndividualContact(sb, ownerUserId, phone, pushName);
            }
            if (!contactId) continue;

            const parsed = detectMessageType(msg);
            const text = isGroup && !fromMe && pushName ? `${pushName}: ${parsed.body}` : parsed.body;
            const { data: inserted, error } = await sb
              .from("crm_messages")
              .upsert(
                {
                  user_id: ownerUserId,
                  contact_id: contactId,
                  body: text,
                  from_me: fromMe,
                  at: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
                  message_id: String(msg.key!.id),
                  remote_jid: jid,
                  type: parsed.type,
                  media_url: parsed.media_url,
                  media_mime: parsed.media_mime,
                  media_caption: parsed.media_caption,
                  status: (msg as any).status ?? null,
                  raw: msg,
                },
                { onConflict: "user_id,message_id", ignoreDuplicates: true },
              )
              .select("id");
            if (error || !inserted?.length) continue;
            imported++;
            contactIds.add(contactId);

            if (!fromMe && !isGroup && !pausedContacts.has(contactId)) {
              pausedContacts.add(contactId);
              await sb
                .from("crm_contact_sequences")
                .update({ status: "paused", paused_at: new Date().toISOString(), pause_reason: "inbound_reply" })
                .eq("user_id", ownerUserId)
                .eq("contact_id", contactId)
                .eq("status", "active");
            }
          }

          return jsonResponse({ ok: true, checked: records.length, imported, contactIds: [...contactIds] });
        } catch (err: any) {
          console.error("[catch-up] unhandled", err?.message ?? err);
          return jsonResponse({ ok: false, error: "internal", detail: err?.message ?? String(err) }, 500);
        }
      },
    },
  },
});

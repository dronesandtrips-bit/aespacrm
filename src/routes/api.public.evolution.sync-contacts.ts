// POST /api/public/evolution/sync-contacts
// Importa contatos que a instância `zapcrm` da Evolution já conhece
// (cache local da Evolution — NÃO consulta o WhatsApp em tempo real,
// portanto risco de ban = praticamente zero).
//
// - Ignora grupos (@g.us) — eles entram pela Inbox quando há mensagem.
// - Ignora números inválidos.
// - Insere em lotes de 200 com tolerância a duplicatas.
// - Não sobrescreve contatos já existentes (apenas insere os novos).
//
// Auth: Authorization: Bearer <user-jwt>
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const BATCH_SIZE = 200;

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

type EvContact = {
  id?: string;        // jid (ex: 5511999@s.whatsapp.net)
  remoteJid?: string;
  pushName?: string | null;
  name?: string | null;
  profilePicUrl?: string | null;
};

export const Route = createFileRoute("/api/public/evolution/sync-contacts")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),

      POST: async ({ request }) => {
        try {
          const apiUrl = process.env.EVOLUTION_API_URL
            ? normalizeUrl(process.env.EVOLUTION_API_URL)
            : "";
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          const supaUrl = process.env.AESPACRM_SUPA_URL
            ? normalizeUrl(process.env.AESPACRM_SUPA_URL)
            : "";
          const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
          if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
            return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
          }

          // Auth
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!token) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

          const userClient = createClient(supaUrl, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            db: { schema: "aespacrm" },
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
          if (authErr || !userRes?.user) {
            return jsonResponse({ ok: false, error: "invalid token" }, 401);
          }
          const userId = userRes.user.id;

          // 1) Busca contatos na Evolution.
          //    Algumas versões usam GET /chat/findContacts, outras POST com {where:{}}.
          //    Tentamos POST primeiro (mais comum nas v2.x); caímos pra GET se falhar.
          let evList: EvContact[] = [];
          try {
            const r1 = await fetch(`${apiUrl}/chat/findContacts/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ where: {} }),
            });
            if (r1.ok) {
              const j = await r1.json().catch(() => []);
              if (Array.isArray(j)) evList = j;
            } else {
              const r2 = await fetch(`${apiUrl}/chat/findContacts/${INSTANCE}`, {
                method: "GET",
                headers: { apikey: apiKey },
              });
              if (r2.ok) {
                const j = await r2.json().catch(() => []);
                if (Array.isArray(j)) evList = j;
              } else {
                const txt = await r2.text();
                return jsonResponse(
                  { ok: false, error: "evolution_failed", status: r2.status, detail: txt.slice(0, 400) },
                  502,
                );
              }
            }
          } catch (err: any) {
            return jsonResponse(
              { ok: false, error: "evolution_unreachable", detail: err?.message ?? String(err) },
              502,
            );
          }

          if (!evList.length) {
            return jsonResponse({
              ok: true,
              fetched: 0,
              imported: 0,
              skipped: 0,
              message: "A Evolution não retornou contatos. Tente sincronizar via app primeiro.",
            });
          }

          // 2) Filtra: só 1:1, com phone numérico válido, descarta grupos/broadcast/status
          type Row = {
            user_id: string;
            name: string;
            phone: string;
            is_group: boolean;
            wa_jid: string;
            avatar_url: string | null;
          };
          const rows: Row[] = [];
          const seenPhones = new Set<string>();
          let skipped = 0;

          for (const c of evList) {
            // ATENÇÃO: o JID real está em `remoteJid`. O campo `id` é um cuid interno
            // do banco da Evolution (ex: cmoj3fe5l05okqi4ytgf2i6t4) — NÃO usar.
            const jid = (c.remoteJid ?? c.id ?? "") as string;
            if (!jid || typeof jid !== "string") {
              skipped++;
              continue;
            }
            // Só queremos 1:1. Aceita @s.whatsapp.net (formato clássico).
            // Ignora @g.us (grupos), @broadcast, status@, e @lid (identificadores
            // anônimos de membros de grupo, sem número real).
            if (!jid.includes("@s.whatsapp.net")) {
              skipped++;
              continue;
            }
            // Filtro adicional: só contatos salvos / reais (type === "contact"),
            // descarta "group_member" mesmo que venha com @s.whatsapp.net.
            const ctype = (c as any).type;
            if (ctype && ctype !== "contact") {
              skipped++;
              continue;
            }
            const phone = digitsOnly(jid.split("@")[0]);
            if (phone.length < 10 || phone.length > 15) {
              skipped++;
              continue;
            }
            if (seenPhones.has(phone)) {
              skipped++;
              continue;
            }
            seenPhones.add(phone);
            const name =
              (c.pushName && c.pushName.trim()) ||
              (c.name && c.name.trim()) ||
              `+${phone}`;
            const avatar_url =
              (typeof c.profilePicUrl === "string" && c.profilePicUrl.trim()) || null;
            rows.push({
              user_id: userId,
              name,
              phone,
              is_group: false,
              wa_jid: jid,
              avatar_url,
            });
          }

          if (!rows.length) {
            return jsonResponse({
              ok: true,
              fetched: evList.length,
              imported: 0,
              skipped,
              message: "Nenhum contato individual válido encontrado.",
            });
          }

          // 3) Primeiro consulta o que já existe e depois insere só os novos.
          //    Evita usar upsert/onConflict aqui porque a chave única real do CRM
          //    é parcial para contatos individuais, e algumas versões do PostgREST
          //    rejeitam ON CONFLICT contra índice parcial.
          const sbAdmin = getSupabaseAdmin();
          let imported = 0;
          let conflicts = 0;
          let errors = 0;
          const errorSamples: string[] = [];

          const existingPhones = new Set<string>();
          const existingByPhone = new Map<string, { id: string; name: string | null; avatar_url: string | null }>();
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const phones = rows.slice(i, i + BATCH_SIZE).map((r) => r.phone);
            const { data: existing, error: existingErr } = await sbAdmin
              .from("crm_contacts")
              .select("id,name,avatar_url,phone_norm,phone")
              .eq("user_id", userId)
              .eq("is_group", false)
              .in("phone_norm", phones);
            if (existingErr) {
              console.error("[sync-contacts] existing lookup error", existingErr.message);
              if (errorSamples.length < 3) errorSamples.push(existingErr.message);
              continue;
            }
            for (const item of existing ?? []) {
              const phone = digitsOnly(item.phone_norm ?? item.phone ?? "");
              if (phone) {
                existingPhones.add(phone);
                existingByPhone.set(phone, {
                  id: item.id,
                  name: item.name ?? null,
                  avatar_url: item.avatar_url ?? null,
                });
              }
            }
          }

          const rowsToInsert = rows.filter((r) => !existingPhones.has(r.phone));
          conflicts = rows.length - rowsToInsert.length;

          // 3.1) Backfill em contatos JÁ existentes:
          //   - avatar_url quando ainda for null
          //   - name quando o atual estiver vazio OU for o fallback "+<phone>"
          //     (ou seja, nunca recebeu pushName real). Não sobrescreve nomes
          //     que o usuário já editou manualmente.
          let avatarsUpdated = 0;
          let namesUpdated = 0;
          for (const r of rows) {
            const existing = existingByPhone.get(r.phone);
            if (!existing) continue;

            const patch: Record<string, string> = {};
            if (!existing.avatar_url && r.avatar_url) {
              patch.avatar_url = r.avatar_url;
            }
            const currentName = (existing.name ?? "").trim();
            const isFallbackName = !currentName || currentName === `+${r.phone}` || currentName === r.phone;
            const newName = r.name.trim();
            const newIsRealName = newName && newName !== `+${r.phone}`;
            if (isFallbackName && newIsRealName) {
              patch.name = newName;
            }
            if (!Object.keys(patch).length) continue;

            const { error: updErr } = await sbAdmin
              .from("crm_contacts")
              .update(patch)
              .eq("id", existing.id);
            if (updErr) {
              if (errorSamples.length < 3) errorSamples.push(updErr.message);
            } else {
              if (patch.avatar_url) avatarsUpdated++;
              if (patch.name) namesUpdated++;
            }
          }

          for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
            const slice = rowsToInsert.slice(i, i + BATCH_SIZE);
            const { error } = await sbAdmin.from("crm_contacts").insert(slice);
            if (error) {
              console.error("[sync-contacts] batch error", error.message);
              if (errorSamples.length < 3) errorSamples.push(error.message);

              for (const row of slice) {
                const { error: oneError } = await sbAdmin.from("crm_contacts").insert(row);
                if (!oneError) {
                  imported++;
                } else if (oneError.code === "23505") {
                  conflicts++;
                } else {
                  errors++;
                  console.error("[sync-contacts] row error", oneError.message);
                  if (errorSamples.length < 3) errorSamples.push(oneError.message);
                }
              }
            } else {
              imported += slice.length;
            }
          }

          return jsonResponse({
            ok: true,
            fetched: evList.length,
            valid: rows.length,
            imported,
            avatarsUpdated,
            namesUpdated,
            alreadyExisted: conflicts,
            invalidOrSkipped: skipped,
            errors,
            lastError: errorSamples[0] ?? null,
          });
        } catch (err: any) {
          console.error("[sync-contacts] unhandled", err?.message ?? err);
          return jsonResponse(
            { ok: false, error: "internal", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});

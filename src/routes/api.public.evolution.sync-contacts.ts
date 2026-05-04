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
          };
          const rows: Row[] = [];
          const seenPhones = new Set<string>();
          let skipped = 0;

          for (const c of evList) {
            const jid = c.id ?? c.remoteJid ?? "";
            if (!jid || typeof jid !== "string") {
              skipped++;
              continue;
            }
            // Só queremos 1:1 (s.whatsapp.net). Ignora @g.us, @broadcast, status@.
            if (!jid.includes("@s.whatsapp.net")) {
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
            rows.push({
              user_id: userId,
              name,
              phone,
              is_group: false,
              wa_jid: jid,
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

          // 3) Insere em lotes. ON CONFLICT no índice único (user_id, phone_norm)
          //    where is_group=false → ignora duplicatas silenciosamente.
          const sbAdmin = getSupabaseAdmin();
          let imported = 0;
          let conflicts = 0;
          let errors = 0;

          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const slice = rows.slice(i, i + BATCH_SIZE);
            const { data, error } = await sbAdmin
              .from("crm_contacts")
              .upsert(slice, {
                onConflict: "user_id,phone_norm",
                ignoreDuplicates: true,
              })
              .select("id");
            if (error) {
              errors += slice.length;
              console.error("[sync-contacts] batch error", error.message);
              continue;
            }
            const inserted = data?.length ?? 0;
            imported += inserted;
            conflicts += slice.length - inserted;
          }

          return jsonResponse({
            ok: true,
            fetched: evList.length,
            valid: rows.length,
            imported,
            alreadyExisted: conflicts,
            invalidOrSkipped: skipped,
            errors,
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

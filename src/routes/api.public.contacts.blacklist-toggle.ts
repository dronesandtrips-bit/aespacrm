// POST /api/public/contacts/blacklist-toggle
// Espelha o comando /off ou /on (vindo do workflow do Robo no n8n) na blacklist
// do ZapCRM. Localiza o(s) contato(s) com aquele telefone normalizado e
// insere/remove de aespacrm.crm_ignored_phones — as triggers do banco
// cuidam de propagar pra crm_contacts.is_ignored e pausar/retomar sequências.
//
// Auth: header x-api-key = N8N_API_KEY
// Body: { phone: string, action: "off" | "on", reason?: string }
import { createFileRoute } from "@tanstack/react-router";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

export const Route = createFileRoute("/api/public/contacts/blacklist-toggle")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      POST: async ({ request }) => {
        try {
          if (!checkApiKey(request)) {
            return jsonResponse({ ok: false, error: "unauthorized" }, 401);
          }

          const body = await request.json().catch(() => ({}));
          const phone = digitsOnly(body?.phone ?? "");
          const action = String(body?.action ?? "").toLowerCase();
          const reason = typeof body?.reason === "string" ? body.reason : "whatsapp:/off";

          if (!phone || phone.length < 6) {
            return jsonResponse({ ok: false, error: "invalid_phone" }, 400);
          }
          if (action !== "off" && action !== "on") {
            return jsonResponse({ ok: false, error: "invalid_action" }, 400);
          }

          const sb = getSupabaseAdmin();

          // Descobre quais user_ids têm esse contato cadastrado no ZapCRM.
          const { data: contacts, error: lookupErr } = await sb
            .from("crm_contacts")
            .select("user_id")
            .eq("phone_norm", phone);

          if (lookupErr) {
            return jsonResponse(
              { ok: false, error: "lookup_failed", detail: lookupErr.message },
              500,
            );
          }

          const userIds = Array.from(
            new Set((contacts ?? []).map((c: any) => c.user_id).filter(Boolean)),
          );

          if (!userIds.length) {
            // Nenhum dono no ZapCRM — silenciosamente OK (contato pode existir só no Robo).
            return jsonResponse({
              ok: true,
              phone,
              action,
              affectedUsers: 0,
              note: "phone not found in any ZapCRM user",
            });
          }

          let affected = 0;
          if (action === "off") {
            // INSERT idempotente em crm_ignored_phones para cada user_id
            const rows = userIds.map((uid) => ({
              user_id: uid,
              phone_norm: phone,
              reason,
            }));
            const { data, error } = await sb
              .from("crm_ignored_phones")
              .upsert(rows, { onConflict: "user_id,phone_norm", ignoreDuplicates: true })
              .select("id");
            if (error) {
              return jsonResponse(
                { ok: false, error: "insert_failed", detail: error.message },
                500,
              );
            }
            affected = data?.length ?? 0;
          } else {
            // /on → DELETE da blacklist; trigger reverte is_ignored e retoma sequências
            const { data, error } = await sb
              .from("crm_ignored_phones")
              .delete()
              .in("user_id", userIds)
              .eq("phone_norm", phone)
              .select("id");
            if (error) {
              return jsonResponse(
                { ok: false, error: "delete_failed", detail: error.message },
                500,
              );
            }
            affected = data?.length ?? 0;
          }

          return jsonResponse({
            ok: true,
            phone,
            action,
            affectedUsers: userIds.length,
            rowsAffected: affected,
          });
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: "internal", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});

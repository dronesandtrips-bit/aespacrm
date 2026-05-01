// POST /api/public/admin/rerun-enrich-jones
// One-shot: dispara o webhook do n8n de enrich pra todos contatos com
// name='Jones Hahn' (bug corrigido — esses foram criados com nome do dono).
// Protegido por x-api-key (N8N_API_KEY).
//
// Pode ser deletado depois que rodar.
import { createFileRoute } from "@tanstack/react-router";
import { checkApiKey, getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const N8N_WEBHOOK_URL = "https://webhook.hostdosul.com/webhook/zapcrm-ai-enrich";

export const Route = createFileRoute("/api/public/admin/rerun-enrich-jones")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!ownerUserId) {
          return jsonResponse({ ok: false, error: "EVOLUTION_OWNER_USER_ID missing" }, 500);
        }
        const sb = getSupabaseAdmin();
        const { data, error } = await sb
          .from("crm_contacts")
          .select("id, phone_norm")
          .eq("user_id", ownerUserId)
          .eq("name", "Jones Hahn")
          .not("phone_norm", "is", null);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        const list = (data ?? []) as Array<{ id: string; phone_norm: string }>;
        const results: Array<{ phone: string; status: number; ok: boolean }> = [];

        for (const c of list) {
          try {
            const r = await fetch(N8N_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone: c.phone_norm }),
            });
            results.push({ phone: c.phone_norm, status: r.status, ok: r.ok });
          } catch (e: any) {
            results.push({ phone: c.phone_norm, status: 0, ok: false });
          }
          // pequeno delay pra não saturar a IA
          await new Promise((res) => setTimeout(res, 800));
        }

        return jsonResponse({
          ok: true,
          total: list.length,
          dispatched: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          sample: results.slice(0, 5),
        });
      },
    },
  },
});

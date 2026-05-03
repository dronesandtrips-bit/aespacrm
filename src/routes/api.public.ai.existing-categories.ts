// GET /api/public/ai/existing-categories
// Retorna a lista de categorias existentes do tenant ZapCRM, para o n8n
// injetar no prompt da IA. A IA deve REUSAR esses nomes (case-insensitive)
// sempre que fizer sentido, evitando criar variações ortográficas.
//
// Segurança: header `x-api-key` igual a N8N_API_KEY.

import { createFileRoute } from "@tanstack/react-router";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/ai/existing-categories")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!ownerUserId) {
          return jsonResponse(
            { ok: false, error: "EVOLUTION_OWNER_USER_ID não configurado" },
            500,
          );
        }

        const sb = getSupabaseAdmin();
        const { data, error } = await sb
          .from("crm_categories")
          .select("name, keywords")
          .eq("user_id", ownerUserId)
          .order("name", { ascending: true });

        if (error) {
          console.error("existing-categories error", error);
          return jsonResponse({ ok: false, error: error.message }, 500);
        }

        const rows = (data ?? [])
          .map((r: any) => ({
            name: String(r?.name ?? "").trim(),
            keywords: Array.isArray(r?.keywords)
              ? (r.keywords as any[]).map((k) => String(k ?? "").trim()).filter(Boolean)
              : [],
          }))
          .filter((r: { name: string }) => r.name);

        // `categories`: lista plana (compat com workflows antigos do n8n).
        // `categories_detailed`: nome + keywords (novo, para a IA priorizar).
        return jsonResponse({
          ok: true,
          categories: rows.map((r: { name: string }) => r.name),
          categories_detailed: rows,
        });
      },
    },
  },
});

// GET /api/public/ai/interest-terms
// Endpoint público (auth via x-api-key) que devolve os Termos de Interesse
// configurados pelo dono do tenant ZapCRM. O n8n consome essa lista para
// injetar como "Dicas de Contexto" no prompt da IA de enriquecimento.
//
// Resposta: { ok: true, terms: string[], updated_at: string | null }

import { createFileRoute } from "@tanstack/react-router";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/ai/interest-terms")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
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
          .from("crm_user_settings")
          .select("interest_terms, updated_at")
          .eq("user_id", ownerUserId)
          .maybeSingle();

        if (error) {
          console.error("interest-terms read error", error);
          return jsonResponse({ ok: false, error: error.message }, 500);
        }

        const terms: string[] = Array.isArray(data?.interest_terms)
          ? (data!.interest_terms as string[]).filter((t) => typeof t === "string" && t.trim())
          : [];

        return jsonResponse({
          ok: true,
          terms,
          updated_at: data?.updated_at ?? null,
          // Dica pronta para o prompt da IA
          prompt_hint: terms.length
            ? `Procure especificamente por menções aos seguintes termos: ${terms.join(", ")}. Se encontrar algum, aplique a tag correspondente (use o próprio termo como nome da categoria) e classifique a intenção como COMPRA (interesse de adquirir) ou SUPORTE (já possui e precisa de ajuda/manutenção).`
            : "",
        });
      },
    },
  },
});

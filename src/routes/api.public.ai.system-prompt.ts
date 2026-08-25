// GET /api/public/ai/system-prompt
// Devolve o system prompt ATIVO (versionado no CRM) para o Robô no n8n.
// Auth: x-api-key (N8N_API_KEY).
//
// Query opcional: ?version=3  -> força uma versão específica (útil p/ testes).
// Resposta: { ok, version, title, content, updated_at }

import { createFileRoute } from "@tanstack/react-router";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

export const Route = createFileRoute("/api/public/ai/system-prompt")({
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

        const url = new URL(request.url);
        const versionParam = url.searchParams.get("version");
        const version = versionParam ? Number(versionParam) : null;

        const sb = getSupabaseAdmin();
        let q = sb
          .from("crm_bot_prompts")
          .select("version, title, content, updated_at")
          .eq("user_id", ownerUserId);
        q = version && Number.isFinite(version) ? q.eq("version", version) : q.eq("is_active", true);

        const { data, error } = await q.maybeSingle();
        if (error) {
          console.error("system-prompt read error", error);
          return jsonResponse({ ok: false, error: error.message }, 500);
        }
        if (!data) {
          return jsonResponse({ ok: false, error: "nenhuma versão ativa", content: "" }, 404);
        }

        return jsonResponse({
          ok: true,
          version: data.version,
          title: data.title ?? "",
          content: data.content ?? "",
          updated_at: data.updated_at ?? null,
        });
      },
    },
  },
});

// POST /api/public/bling/auto-tick
// Cron (n8n, a cada 5-15 min) OU botão "Executar agora" no CRM.
// Auth: x-api-key (N8N_API_KEY) → roda para todos os usuários com o
// disparo automático ligado; ou Bearer <user-jwt> → roda só para o usuário.
import { createFileRoute } from "@tanstack/react-router";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
  requireUserJwt,
} from "@/integrations/supabase/server";
import { runBlingAutoTick } from "@/server/bling-auto.server";

export const Route = createFileRoute("/api/public/bling/auto-tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        // 1) chamada do usuário logado (teste manual)
        const authHeader = request.headers.get("authorization") ?? "";
        if (authHeader.startsWith("Bearer ")) {
          const auth = await requireUserJwt(request);
          if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
          const force = new URL(request.url).searchParams.get("force") === "1";
          const result = await runBlingAutoTick(auth.userId, { force });
          return jsonResponse(result, result.ok ? 200 : 500);
        }

        // 2) cron do n8n
        if (!checkApiKey(request)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

        const sb = getSupabaseAdmin();
        const { data: rows, error } = await sb
          .from("crm_app_secrets")
          .select("user_id, value")
          .eq("name", "BLING_AUTO_CONFIG");
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        const users = (rows ?? [])
          .filter((r: any) => {
            try {
              return Boolean(JSON.parse(r.value)?.enabled);
            } catch {
              return false;
            }
          })
          .map((r: any) => String(r.user_id))
          .slice(0, 10);

        const results: any[] = [];
        for (const userId of users) {
          results.push({ userId, ...(await runBlingAutoTick(userId)) });
        }
        return jsonResponse({ ok: true, users: users.length, results });
      },
    },
  },
});

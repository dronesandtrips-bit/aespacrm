// /api/public/evolution/watchdog
// GET  (login do CRM): estado da sentinela da conexão (para a faixa de aviso).
// POST (x-api-key do n8n ou login do CRM): executa uma verificação agora.
import { createFileRoute } from "@tanstack/react-router";
import { checkApiKey, getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";
import { readWatchdogState, runWatchdog } from "@/server/evolution-watchdog.server";

async function authorize(request: Request, sb: any) {
  const auth = await requireUserJwt(request);
  if ("error" in auth) return { error: auth.error, status: auth.status };
  const { data: allowed } = await sb.from("crm_allowed_users").select("user_id").eq("user_id", auth.userId).maybeSingle();
  if (!allowed) return { error: "Não autorizado", status: 403 };
  return { userId: auth.userId };
}

export const Route = createFileRoute("/api/public/evolution/watchdog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sb = getSupabaseAdmin();
        const a = await authorize(request, sb);
        if ("error" in a) return Response.json({ ok: false, error: a.error }, { status: a.status });
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!ownerUserId) return Response.json({ ok: false, error: "EVOLUTION_OWNER_USER_ID não configurado" }, { status: 500 });
        const state = await readWatchdogState(sb, ownerUserId);
        return Response.json({ ok: true, state });
      },
      POST: async ({ request }) => {
        const sb = getSupabaseAdmin();
        const cron = checkApiKey(request);
        if (!cron) {
          const a = await authorize(request, sb);
          if ("error" in a) return Response.json({ ok: false, error: a.error }, { status: a.status });
        }
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!apiUrl || !apiKey || !ownerUserId) return Response.json({ ok: false, error: "Configuração da Evolution ausente" }, { status: 500 });
        try {
          const result = await runWatchdog({ sb, apiUrl, apiKey, ownerUserId, force: !cron });
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});

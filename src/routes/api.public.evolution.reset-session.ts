// POST /api/public/evolution/reset-session
// "Reconectar do zero": encerra a sessão da instância zapcrm (somente ela)
// para que a tela do WhatsApp mostre um novo QR Code. Usado quando a conexão
// fica "zumbi" (ligada, mas sem receber mensagens) e reiniciar não resolve.
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, requireUserJwt } from "@/integrations/supabase/server";
import { EMPTY_STATE, WATCHDOG_STATE_KEY } from "@/lib/evolution-watchdog";

const INSTANCE = "zapcrm";

export const Route = createFileRoute("/api/public/evolution/reset-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        const sb = getSupabaseAdmin();
        const { data: allowed } = await sb.from("crm_allowed_users").select("user_id").eq("user_id", auth.userId).maybeSingle();
        if (!allowed) return Response.json({ ok: false, error: "Não autorizado" }, { status: 403 });
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!apiUrl || !apiKey || !ownerUserId) return Response.json({ ok: false, error: "Configuração da Evolution ausente" }, { status: 500 });

        const res = await fetch(`${apiUrl}/instance/logout/${INSTANCE}`, {
          method: "DELETE",
          headers: { apikey: apiKey },
          signal: AbortSignal.timeout(20_000),
        });
        const body = await res.text();
        if (!res.ok) {
          return Response.json({ ok: false, error: `A Evolution recusou o pedido (${res.status}): ${body.slice(0, 300)}` }, { status: 502 });
        }
        await sb.from("crm_app_secrets").upsert(
          { user_id: ownerUserId, name: WATCHDOG_STATE_KEY, value: JSON.stringify({ ...EMPTY_STATE, lastCheckAt: new Date().toISOString() }), updated_at: new Date().toISOString() },
          { onConflict: "user_id,name" },
        );
        return Response.json({ ok: true });
      },
    },
  },
});

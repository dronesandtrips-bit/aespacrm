// Debug: gera o link /u/$token para um telefone arbitrário, sem precisar
// disparar mensagem real no WhatsApp. Útil para testar a página de
// descadastro ponta-a-ponta usando só o navegador.
// Protegido por EVOLUTION_API_KEY (mesma chave dos outros debugs).
// REMOVER quando não precisar mais.
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";
import { generateOptoutToken, buildOptoutUrl } from "@/server/optout.server";

export const Route = createFileRoute("/api/public/debug/optout-link")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        const got = request.headers.get("apikey");
        if (!apiKey || got !== apiKey) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
        if (!ownerUserId) {
          return jsonResponse({ ok: false, error: "EVOLUTION_OWNER_USER_ID not set" }, 500);
        }
        const url = new URL(request.url);
        const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
        const userId = url.searchParams.get("user_id")?.trim() || ownerUserId;
        if (!phone) return jsonResponse({ ok: false, error: "phone required" }, 400);

        const token = await generateOptoutToken(userId, phone);
        if (!token) {
          return jsonResponse(
            { ok: false, error: "could not generate token (optout_secret missing?)" },
            500,
          );
        }
        return jsonResponse({
          ok: true,
          user_id: userId,
          phone,
          token,
          url: buildOptoutUrl(token),
        });
      },
    },
  },
});

// POST /api/public/optout/confirm
// Recebe { token } e executa o opt-out (insere na blacklist + envia
// confirmação via WhatsApp). É a ação destrutiva — exige POST.
import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";
import { verifyOptoutToken, performOptOut } from "@/server/optout.server";

export const Route = createFileRoute("/api/public/optout/confirm")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const { token } = await request.json().catch(() => ({}));
          if (!token || typeof token !== "string") {
            return jsonResponse({ ok: false, error: "missing token" }, 400);
          }
          const verified = await verifyOptoutToken(token);
          if (!verified) {
            return jsonResponse({ ok: false, error: "invalid token" }, 400);
          }
          const result = await performOptOut({
            userId: verified.userId,
            phone: verified.phone,
            source: "link_click",
            sendConfirmation: true,
          });
          if (!result.ok) {
            return jsonResponse({ ok: false, error: result.error ?? "failed" }, 500);
          }
          return jsonResponse({ ok: true, already_opted_out: result.alreadyOptedOut });
        } catch (err: any) {
          console.error("[optout/confirm]", err);
          return jsonResponse({ ok: false, error: "internal error" }, 500);
        }
      },
    },
  },
});

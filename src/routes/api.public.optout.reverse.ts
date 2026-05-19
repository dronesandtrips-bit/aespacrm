// POST /api/public/optout/reverse
// Recebe { token } e remove o telefone da blacklist (re-opt-in).
import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";
import { verifyOptoutToken, performOptIn } from "@/server/optout.server";

export const Route = createFileRoute("/api/public/optout/reverse")({
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
          const result = await performOptIn({
            userId: verified.userId,
            phone: verified.phone,
            sendConfirmation: true,
          });
          if (!result.ok) {
            return jsonResponse({ ok: false, error: result.error ?? "failed" }, 500);
          }
          return jsonResponse({ ok: true, was_opted_out: result.wasOptedOut });
        } catch (err: any) {
          console.error("[optout/reverse]", err);
          return jsonResponse({ ok: false, error: "internal error" }, 500);
        }
      },
    },
  },
});

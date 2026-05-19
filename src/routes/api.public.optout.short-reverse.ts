// POST /api/public/optout/short-reverse
// Recebe { code } e remove o telefone da blacklist (re-opt-in) via shortlink.
import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";
import { resolveShortCode, performOptIn } from "@/server/optout.server";

export const Route = createFileRoute("/api/public/optout/short-reverse")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        try {
          const { code } = await request.json().catch(() => ({}));
          if (!code || typeof code !== "string") {
            return jsonResponse({ ok: false, error: "missing code" }, 400);
          }
          const verified = await resolveShortCode(code);
          if (!verified) {
            return jsonResponse({ ok: false, error: "invalid code" }, 400);
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
          console.error("[optout/short-reverse]", err);
          return jsonResponse({ ok: false, error: "internal error" }, 500);
        }
      },
    },
  },
});

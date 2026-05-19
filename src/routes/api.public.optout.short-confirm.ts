// POST /api/public/optout/short-confirm
// Recebe { code } e executa o opt-out via shortlink.
import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";
import { resolveShortCode, performOptOut } from "@/server/optout.server";

export const Route = createFileRoute("/api/public/optout/short-confirm")({
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
          console.error("[optout/short-confirm]", err);
          return jsonResponse({ ok: false, error: "internal error" }, 500);
        }
      },
    },
  },
});

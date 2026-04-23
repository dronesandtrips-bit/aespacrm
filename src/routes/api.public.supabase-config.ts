import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/supabase-config")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.AESPACRM_SUPA_URL;
        const anonKey = process.env.AESPACRM_SUPA_ANON_KEY;

        if (!url || !anonKey) {
          return new Response(
            JSON.stringify({
              error: "missing_secrets",
              hasUrl: Boolean(url),
              hasAnonKey: Boolean(anonKey),
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(JSON.stringify({ url, anonKey }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, max-age=60",
          },
        });
      },
    },
  },
});

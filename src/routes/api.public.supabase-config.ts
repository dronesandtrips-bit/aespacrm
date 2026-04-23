import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/supabase-config")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.AESPACRM_SUPA_URL;
        const anonKey = process.env.AESPACRM_SUPA_ANON_KEY;

        if (!url || !anonKey) {
          return Response.json(
            {
              error:
                "Configuração pública do Supabase não encontrada nas secrets do projeto.",
            },
            { status: 503 },
          );
        }

        return Response.json({ url, anonKey });
      },
    },
  },
});

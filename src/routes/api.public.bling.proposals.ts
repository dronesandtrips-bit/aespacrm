// /api/public/bling/proposals — lista propostas comerciais recentes do Bling (JWT obrigatório).
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, requireUserJwt, PUBLIC_CORS } from "@/integrations/supabase/server";
import { listProposals } from "@/server/bling.server";

export const Route = createFileRoute("/api/public/bling/proposals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const url = new URL(request.url);
        const dias = Number(url.searchParams.get("dias") ?? 90);
        const limite = Number(url.searchParams.get("limite") ?? 100);
        try {
          const items = await listProposals(auth.userId, { dias, limite });
          return jsonResponse({ ok: true, items, count: items.length });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro ao consultar o Bling" }, 500);
        }
      },
    },
  },
});

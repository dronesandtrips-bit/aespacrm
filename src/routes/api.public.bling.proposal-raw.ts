// /api/public/bling/proposal-raw — payload cru de UMA proposta (diagnóstico, JWT obrigatório).
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, requireUserJwt, PUBLIC_CORS } from "@/integrations/supabase/server";
import { getProposalRaw } from "@/server/bling.server";

export const Route = createFileRoute("/api/public/bling/proposal-raw")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!id) return jsonResponse({ ok: false, error: "id obrigatório" }, 400);
        try {
          const raw = await getProposalRaw(auth.userId, id);
          return jsonResponse({ ok: true, raw });
        } catch (err: any) {
          return jsonResponse({ ok: false, error: err?.message ?? "erro no Bling" }, 500);
        }
      },
    },
  },
});

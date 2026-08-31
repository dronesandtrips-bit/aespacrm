// /api/public/bling/contacts — lista contatos (clientes/fornecedores) do Bling (JWT obrigatório).
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, requireUserJwt, PUBLIC_CORS } from "@/integrations/supabase/server";
import { listContacts } from "@/server/bling.server";

export const Route = createFileRoute("/api/public/bling/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      GET: async ({ request }) => {
        const auth = await requireUserJwt(request);
        if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
        const url = new URL(request.url);
        const limite = Number(url.searchParams.get("limite") ?? 300);
        try {
          const items = await listContacts(auth.userId, { limite });
          return jsonResponse({ ok: true, items, count: items.length });
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: err?.message ?? "erro ao consultar contatos do Bling" },
            500,
          );
        }
      },
    },
  },
});

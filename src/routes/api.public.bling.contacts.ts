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
        const limite = Number(url.searchParams.get("limite") ?? 2000);
        // Por padrão traz só clientes (exclui fornecedores) e só quem tem CPF/CNPJ.
        const apenasClientes = url.searchParams.get("clientes") !== "0";
        const comDocumento = url.searchParams.get("comDocumento") !== "0";
        const busca = url.searchParams.get("busca") ?? "";
        try {
          const items = await listContacts(auth.userId, {
            limite,
            apenasClientes,
            comDocumento,
            busca,
          });
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

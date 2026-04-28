// GET /api/public/evolution/test
// Testa a conexão com a Evolution API usando EVOLUTION_API_URL + EVOLUTION_API_KEY.
// Retorna status, lista de instâncias (se houver) ou o erro recebido.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/evolution/test")({
  server: {
    handlers: {
      GET: async () => {
        const rawUrl = process.env.EVOLUTION_API_URL ?? "";
        const apiKey = process.env.EVOLUTION_API_KEY ?? "";
        const url = rawUrl.replace(/\/+$/, "");

        if (!url || !apiKey) {
          return Response.json(
            {
              ok: false,
              reason: "missing_secrets",
              has_url: !!url,
              has_key: !!apiKey,
            },
            { status: 500 },
          );
        }

        const target = `${url}/instance/fetchInstances`;
        try {
          const res = await fetch(target, {
            method: "GET",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
          });
          const text = await res.text();
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // mantém como texto
          }
          const instances = Array.isArray(body) ? body : null;
          return Response.json({
            ok: res.ok,
            status: res.status,
            target,
            instances_count: instances?.length ?? null,
            instances_preview:
              instances?.slice(0, 5).map((i: any) => ({
                name: i?.name ?? i?.instance?.instanceName ?? null,
                state:
                  i?.connectionStatus ??
                  i?.instance?.state ??
                  i?.state ??
                  null,
              })) ?? null,
            body: instances ? undefined : body,
          });
        } catch (err: any) {
          return Response.json(
            {
              ok: false,
              reason: "fetch_failed",
              target,
              error: err?.message ?? String(err),
            },
            { status: 502 },
          );
        }
      },
    },
  },
});

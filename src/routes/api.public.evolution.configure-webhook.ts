// POST /api/public/evolution/configure-webhook
// Registra na Evolution API o webhook que aponta de volta pro ZapCRM.
// Idempotente — pode ser chamado quantas vezes quiser.
import { createFileRoute } from "@tanstack/react-router";

const INSTANCE = "zapcrm";

const EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "CHATS_UPSERT",
];

export const Route = createFileRoute("/api/public/evolution/configure-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) {
          return Response.json(
            { ok: false, error: "EVOLUTION_API_URL/KEY não configurado" },
            { status: 500 },
          );
        }

        // URL pública estável do ZapCRM (production)
        const publicUrl =
          process.env.ZAPCRM_PUBLIC_URL?.trim().replace(/\/+$/, "") ??
          "https://aespacrm.lovable.app";
        const webhookUrl = `${publicUrl}/api/public/evolution/webhook`;

        const res = await fetch(`${apiUrl}/webhook/set/${INSTANCE}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: apiKey,
          },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrl,
              byEvents: false,        // tudo no mesmo endpoint
              base64: false,
              events: EVENTS,
              headers: {
                apikey: apiKey,        // Evolution reenvia esse header → autenticação
                "Content-Type": "application/json",
              },
            },
          }),
        });

        const text = await res.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}

        if (!res.ok) {
          return Response.json(
            { ok: false, status: res.status, error: data, url: webhookUrl },
            { status: 502 },
          );
        }

        return Response.json({
          ok: true,
          instance: INSTANCE,
          webhook_url: webhookUrl,
          events: EVENTS,
          data,
        });
      },
    },
  },
});

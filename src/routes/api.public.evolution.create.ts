// POST /api/public/evolution/create
// Cria a instância dedicada `zapcrm` na Evolution API self-hosted.
// Idempotente: se a instância já existir, retorna ok=true sem recriar.
import { createFileRoute } from "@tanstack/react-router";

const INSTANCE = "zapcrm";

export const Route = createFileRoute("/api/public/evolution/create")({
  server: {
    handlers: {
      POST: async () => {
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (!apiUrl || !apiKey) {
          return Response.json(
            { ok: false, error: "EVOLUTION_API_URL/KEY não configurado" },
            { status: 500 },
          );
        }

        // 1. Checa se já existe
        try {
          const check = await fetch(
            `${apiUrl}/instance/fetchInstances?instanceName=${INSTANCE}`,
            { headers: { apikey: apiKey } },
          );
          if (check.ok) {
            const arr = await check.json().catch(() => []);
            if (Array.isArray(arr) && arr.length > 0) {
              return Response.json({
                ok: true,
                instance: INSTANCE,
                created: false,
                already_exists: true,
              });
            }
          }
        } catch {
          // segue pra criação
        }

        // 2. Cria instância nova
        const res = await fetch(`${apiUrl}/instance/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: apiKey,
          },
          body: JSON.stringify({
            instanceName: INSTANCE,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,
            rejectCall: true,
            groupsIgnore: true,
            alwaysOnline: true,
            readMessages: false,
            readStatus: false,
            syncFullHistory: false,
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return Response.json(
            { ok: false, status: res.status, error: body },
            { status: 502 },
          );
        }

        return Response.json({
          ok: true,
          instance: INSTANCE,
          created: true,
          data: body,
        });
      },
    },
  },
});

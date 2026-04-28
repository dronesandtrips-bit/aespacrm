// GET /api/public/evolution/qr
// Solicita um QR code novo para a instância `zapcrm` (endpoint connect).
import { createFileRoute } from "@tanstack/react-router";

const INSTANCE = "zapcrm";

export const Route = createFileRoute("/api/public/evolution/qr")({
  server: {
    handlers: {
      GET: async () => {
        const url = (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY ?? "";
        if (!url || !apiKey) {
          return Response.json({ ok: false, reason: "missing_secrets" }, { status: 500 });
        }
        try {
          let res = await fetch(`${url}/instance/connect/${INSTANCE}`, {
            method: "GET",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
          });
          let text = await res.text();
          let body: any = text;
          try { body = JSON.parse(text); } catch {}

          // Se a instância ainda não existe, cria e tenta de novo (idempotente)
          if (!res.ok && (res.status === 404 || /not.?found|does not exist/i.test(text))) {
            await fetch(`${url}/instance/create`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                instanceName: INSTANCE,
                integration: "WHATSAPP-BAILEYS",
                qrcode: true,
                rejectCall: true,
                groupsIgnore: true,
                alwaysOnline: true,
              }),
            });
            res = await fetch(`${url}/instance/connect/${INSTANCE}`, {
              method: "GET",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
            });
            text = await res.text();
            try { body = JSON.parse(text); } catch { body = text; }
          }

          if (!res.ok) {
            return Response.json({ ok: false, status: res.status, body }, { status: 502 });
          }
          // Evolution costuma retornar { base64, code, pairingCode, count }
          const base64 = body?.base64 ?? body?.qrcode?.base64 ?? null;
          const code = body?.code ?? body?.qrcode?.code ?? null;
          const pairingCode = body?.pairingCode ?? null;
          return Response.json({
            ok: true,
            instance: INSTANCE,
            base64, // data:image/png;base64,...
            code,   // string crua, pode renderizar com QR client-side
            pairingCode,
          });
        } catch (err: any) {
          return Response.json(
            { ok: false, reason: "fetch_failed", error: err?.message ?? String(err) },
            { status: 502 },
          );
        }
      },
    },
  },
});

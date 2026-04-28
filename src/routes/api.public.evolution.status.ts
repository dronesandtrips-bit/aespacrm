// GET /api/public/evolution/status
// Retorna o status da instância `roboaespa` na Evolution API.
import { createFileRoute } from "@tanstack/react-router";

const INSTANCE = "roboaespa";

export const Route = createFileRoute("/api/public/evolution/status")({
  server: {
    handlers: {
      GET: async () => {
        const url = (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY ?? "";
        if (!url || !apiKey) {
          return Response.json({ ok: false, reason: "missing_secrets" }, { status: 500 });
        }

        try {
          const res = await fetch(`${url}/instance/fetchInstances?instanceName=${INSTANCE}`, {
            method: "GET",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
          });
          const text = await res.text();
          let body: any = text;
          try { body = JSON.parse(text); } catch {}
          if (!res.ok) {
            return Response.json({ ok: false, status: res.status, body }, { status: 502 });
          }
          const list = Array.isArray(body) ? body : [];
          const inst = list.find((i: any) => i?.name === INSTANCE) ?? list[0];
          if (!inst) {
            return Response.json({ ok: true, found: false, instance: INSTANCE });
          }
          const counts = inst?._count ?? {};
          return Response.json({
            ok: true,
            found: true,
            instance: inst.name ?? INSTANCE,
            state: inst.connectionStatus ?? "unknown", // open|connecting|close
            number: inst.ownerJid ? String(inst.ownerJid).split("@")[0] : null,
            profileName: inst.profileName ?? null,
            profilePicUrl: inst.profilePicUrl ?? null,
            counts: {
              messages: counts.Message ?? null,
              contacts: counts.Contact ?? null,
              chats: counts.Chat ?? null,
            },
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

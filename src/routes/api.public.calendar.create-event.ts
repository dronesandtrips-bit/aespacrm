// POST /api/public/calendar/create-event
// Cria um evento no Google Calendar da conta conectada (jehahn38@gmail.com)
// via Lovable Connector Gateway. Aditivo: não toca em nenhum fluxo existente.
//
// Body: { title, startISO, durationMinutes, description?, timeZone? }
// Auth: Bearer JWT do usuário logado (frontend) OU x-api-key (n8n).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, requireUserJwt } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

const EventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startISO: z.string().trim().min(10).max(40),
  durationMinutes: z.number().int().min(5).max(1440),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().max(300).optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
});

export const Route = createFileRoute("/api/public/calendar/create-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          const auth = await requireUserJwt(request);
          if ("error" in auth) {
            return Response.json({ ok: false, error: auth.error }, { status: auth.status });
          }
        }

        const lovableKey = process.env.LOVABLE_API_KEY?.trim();
        const connKey = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
        if (!lovableKey || !connKey) {
          return Response.json(
            { ok: false, error: "Google Calendar não está conectado neste projeto" },
            { status: 500 },
          );
        }

        let parsed: z.infer<typeof EventSchema>;
        try {
          parsed = EventSchema.parse(await request.json());
        } catch (e: any) {
          return Response.json(
            { ok: false, error: "payload inválido", detail: e?.message ?? String(e) },
            { status: 400 },
          );
        }

        const start = new Date(parsed.startISO);
        if (Number.isNaN(start.getTime())) {
          return Response.json({ ok: false, error: "data/hora inválida" }, { status: 400 });
        }
        const end = new Date(start.getTime() + parsed.durationMinutes * 60_000);
        const timeZone = parsed.timeZone || "America/Sao_Paulo";

        const res = await fetch(
          `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": connKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: parsed.title,
              description: parsed.description ?? undefined,
              location: parsed.location || undefined,
              start: { dateTime: start.toISOString(), timeZone },
              end: { dateTime: end.toISOString(), timeZone },
              reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
            }),
          },
        );

        const text = await res.text();
        if (!res.ok) {
          console.error(`Google Calendar gateway falhou [${res.status}]: ${text}`);
          return Response.json(
            { ok: false, error: `Google Calendar [${res.status}]: ${text.slice(0, 500)}` },
            { status: res.status },
          );
        }

        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          /* resposta sem JSON */
        }

        return Response.json({
          ok: true,
          id: data?.id ?? null,
          htmlLink: data?.htmlLink ?? null,
          start: data?.start?.dateTime ?? start.toISOString(),
        });
      },
    },
  },
});

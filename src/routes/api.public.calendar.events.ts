// GET /api/public/calendar/events
// Lista compromissos do Google Agenda conectado (jehahn38@gmail.com).
// Auth: Bearer JWT do usuário logado OU x-api-key (n8n).
// Aditivo: leitura apenas.

import { createFileRoute } from "@tanstack/react-router";
import { checkApiKey, requireUserJwt } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

export const Route = createFileRoute("/api/public/calendar/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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

        const url = new URL(request.url);
        const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 60), 1), 365);
        const past = Math.min(Math.max(Number(url.searchParams.get("past") ?? 7), 0), 365);
        const timeMin = new Date(Date.now() - past * 86_400_000).toISOString();
        const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();

        const qs = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "100",
        });

        const res = await fetch(
          `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${qs}`,
          {
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": connKey,
            },
          },
        );
        const text = await res.text();
        if (!res.ok) {
          console.error(`Google Calendar list falhou [${res.status}]: ${text}`);
          return Response.json(
            { ok: false, error: `Google Calendar [${res.status}]: ${text.slice(0, 400)}` },
            { status: res.status },
          );
        }

        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          /* ignore */
        }

        const events = (data?.items ?? [])
          .filter((e: any) => e?.status !== "cancelled")
          .map((e: any) => ({
            id: e.id as string,
            title: (e.summary as string) ?? "(sem título)",
            description: (e.description as string) ?? "",
            location: (e.location as string) ?? "",
            htmlLink: (e.htmlLink as string) ?? null,
            start: e.start?.dateTime ?? e.start?.date ?? null,
            end: e.end?.dateTime ?? e.end?.date ?? null,
            allDay: Boolean(e.start?.date && !e.start?.dateTime),
          }));

        return Response.json({ ok: true, events });
      },
    },
  },
});

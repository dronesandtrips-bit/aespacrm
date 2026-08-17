// GET /api/public/calendar/events
// Lista compromissos do Google Agenda conectado (jehahn38@gmail.com).
// Auth: Bearer JWT do usuário logado OU x-api-key (n8n).
// Aditivo: leitura apenas.

import { createFileRoute } from "@tanstack/react-router";
import { checkApiKey, requireUserJwt, getSupabaseAdmin } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

export const Route = createFileRoute("/api/public/calendar/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let userId: string | null = null;
        if (!checkApiKey(request)) {
          const auth = await requireUserJwt(request);
          if ("error" in auth) {
            return Response.json({ ok: false, error: auth.error }, { status: auth.status });
          }
          userId = auth.userId;
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
            pending: String(e.summary ?? "").trim().startsWith("(a confirmar)"),
          }));

        // Anexa os lembretes pendentes (contato/antecedência) de cada evento.
        if (userId && events.length) {
          try {
            const sb = getSupabaseAdmin();
            const { data: rems } = await sb
              .from("crm_appointment_reminders")
              .select("event_id, target, phone, contact_name, remind_at, start_at")
              .eq("user_id", userId)
              .in("status", ["pending", "paused"])
              .in(
                "event_id",
                events.map((e: any) => e.id),
              );
            const byEvent = new Map<string, any>();
            for (const r of rems ?? []) {
              const cur = byEvent.get(r.event_id) ?? {
                contactPhone: "",
                contactName: "",
                ownerPhone: "",
                reminderMinutes: null as number | null,
              };
              if (r.target === "client") {
                cur.contactPhone = r.phone;
                cur.contactName = r.contact_name ?? "";
              } else if (r.target === "owner") {
                cur.ownerPhone = r.phone;
              }
              if (cur.reminderMinutes == null && r.start_at && r.remind_at) {
                cur.reminderMinutes = Math.round(
                  (new Date(r.start_at).getTime() - new Date(r.remind_at).getTime()) / 60000,
                );
              }
              byEvent.set(r.event_id, cur);
            }
            for (const e of events as any[]) {
              e.reminder = byEvent.get(e.id) ?? null;
            }
          } catch (e: any) {
            console.error(`[calendar] falha ao ler lembretes: ${e?.message ?? String(e)}`);
          }
        }

        return Response.json({ ok: true, events });
      },
    },
  },
});

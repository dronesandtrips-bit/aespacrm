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
        const { CalendarRangeSchema, listCalendarEvents } = await import("@/server/calendar-events.server");
        const range = CalendarRangeSchema.safeParse(Object.fromEntries(url.searchParams));
        if (!range.success) return Response.json({ ok: false, error: "Período inválido (até 365 dias)" }, { status: 400 });
        let items: any[];
        try {
          items = await listCalendarEvents(range.data.days, range.data.past);
          const owner = process.env.EVOLUTION_OWNER_USER_ID?.trim();
          if (owner && (!userId || userId === owner)) {
            const { syncClosures } = await import("@/server/agenda-closure.server");
            await syncClosures(getSupabaseAdmin(), owner, items);
          }
        } catch (error) {
          return Response.json({ ok: false, error: String(error) }, { status: 500 });
        }

        const events = items
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

        return Response.json({ ok: true, events }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});

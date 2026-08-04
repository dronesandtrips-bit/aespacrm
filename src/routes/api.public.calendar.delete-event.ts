// POST /api/public/calendar/delete-event
// Cancela um compromisso no Google Agenda e cancela os lembretes pendentes.
// Auth: Bearer JWT do usuário logado OU x-api-key (n8n).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, requireUserJwt, getSupabaseAdmin } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

const Schema = z.object({ eventId: z.string().trim().min(1).max(200) });

export const Route = createFileRoute("/api/public/calendar/delete-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        let parsed: z.infer<typeof Schema>;
        try {
          parsed = Schema.parse(await request.json());
        } catch (e: any) {
          return Response.json(
            { ok: false, error: "payload inválido", detail: e?.message ?? String(e) },
            { status: 400 },
          );
        }

        const res = await fetch(
          `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(parsed.eventId)}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": connKey,
            },
          },
        );
        // 410 = já removido no Google; tratamos como sucesso.
        if (!res.ok && res.status !== 410) {
          const text = await res.text();
          console.error(`Google Calendar delete falhou [${res.status}]: ${text}`);
          return Response.json(
            { ok: false, error: `Google Calendar [${res.status}]: ${text.slice(0, 400)}` },
            { status: res.status },
          );
        }

        let remindersCanceled = 0;
        if (userId) {
          try {
            const sb = getSupabaseAdmin();
            const { data: rows } = await sb
              .from("crm_appointment_reminders")
              .update({ status: "canceled" })
              .eq("user_id", userId)
              .eq("event_id", parsed.eventId)
              .eq("status", "pending")
              .select("id");
            remindersCanceled = (rows ?? []).length;
          } catch (e: any) {
            console.error(`[calendar] falha ao cancelar lembretes: ${e?.message ?? String(e)}`);
          }
        }

        return Response.json({ ok: true, remindersCanceled });
      },
    },
  },
});

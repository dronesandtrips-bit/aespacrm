// POST /api/public/calendar/update-event
// Edita um compromisso existente no Google Agenda e reajusta os lembretes
// pendentes (mantendo a antecedência escolhida originalmente).
// Auth: Bearer JWT do usuário logado OU x-api-key (n8n).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, requireUserJwt, getSupabaseAdmin } from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

const PatchSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  startISO: z.string().trim().min(10).max(40),
  durationMinutes: z.number().int().min(5).max(1440),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().max(300).optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  // Lembretes automáticos por WhatsApp (opcional, aditivo)
  reminderMinutes: z.number().int().min(5).max(10080).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?\d*$/)
    .optional(),
  ownerPhone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?\d*$/)
    .optional(),
  /** quando true, recria os lembretes com base nos campos acima */
  replaceReminders: z.boolean().optional(),
});


export const Route = createFileRoute("/api/public/calendar/update-event")({
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

        let parsed: z.infer<typeof PatchSchema>;
        try {
          parsed = PatchSchema.parse(await request.json());
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
          `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(parsed.eventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": connKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: parsed.title,
              description: parsed.description ?? undefined,
              location: parsed.location ?? "",
              start: { dateTime: start.toISOString(), timeZone },
              end: { dateTime: end.toISOString(), timeZone },
            }),
          },
        );
        const text = await res.text();
        if (!res.ok) {
          console.error(`Google Calendar patch falhou [${res.status}]: ${text}`);
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

        const mapsLink = parsed.location
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parsed.location)}`
          : null;

        // Reajusta lembretes pendentes deste evento (best-effort).
        let remindersUpdated = 0;
        if (userId) {
          try {
            const sb = getSupabaseAdmin();
            const { data: rows } = await sb
              .from("crm_appointment_reminders")
              .select("id, start_at, remind_at")
              .eq("user_id", userId)
              .eq("event_id", parsed.eventId)
              .eq("status", "pending");
            for (const r of rows ?? []) {
              const offset =
                new Date(r.start_at).getTime() - new Date(r.remind_at).getTime();
              const nextRemind = new Date(start.getTime() - offset).toISOString();
              const { error: upErr } = await sb
                .from("crm_appointment_reminders")
                .update({
                  title: parsed.title,
                  start_at: start.toISOString(),
                  location: parsed.location ?? null,
                  maps_link: mapsLink,
                  html_link: data?.htmlLink ?? null,
                  remind_at: nextRemind,
                })
                .eq("id", r.id);
              if (!upErr) remindersUpdated += 1;
            }
          } catch (e: any) {
            console.error(`[calendar] falha ao reajustar lembretes: ${e?.message ?? String(e)}`);
          }
        }

        return Response.json({
          ok: true,
          remindersUpdated,
          id: data?.id ?? parsed.eventId,
          htmlLink: data?.htmlLink ?? null,
          mapsLink,
          start: data?.start?.dateTime ?? start.toISOString(),
        });
      },
    },
  },
});

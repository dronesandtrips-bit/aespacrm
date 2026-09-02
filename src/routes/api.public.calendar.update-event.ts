// POST /api/public/calendar/update-event
// Edita um compromisso existente no Google Agenda e reajusta os lembretes
// pendentes (mantendo a antecedência escolhida originalmente).
// Auth: Bearer JWT do usuário logado OU x-api-key (n8n).

import { createFileRoute } from "@tanstack/react-router";
import { buildShortMapsUrl } from "@/lib/maps-link";
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
  /** avisa o cliente AGORA no WhatsApp sobre a alteração */
  notifyNow: z.boolean().optional(),
});

const INSTANCE = "zapcrm";

async function sendWhatsApp(number: string, text: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) throw new Error("EVOLUTION_API_URL/KEY ausentes");
  const res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: number.replace(/\D/g, ""), text , linkPreview: false }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Evolution [${res.status}]: ${body.slice(0, 300)}`);
}



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

        const mapsLink = buildShortMapsUrl(parsed.location);

        // Reajusta (ou recria) lembretes pendentes deste evento (best-effort).
        let remindersUpdated = 0;
        if (userId) {
          try {
            const sb = getSupabaseAdmin();

            if (parsed.replaceReminders) {
              // Recria os lembretes conforme o contato/antecedência escolhidos.
              await sb
                .from("crm_appointment_reminders")
                .delete()
                .eq("user_id", userId)
                .eq("event_id", parsed.eventId)
                .eq("status", "pending");

              const minutes = parsed.reminderMinutes ?? 60;
              const remindAt = new Date(start.getTime() - minutes * 60_000);
              const base = {
                user_id: userId,
                event_id: parsed.eventId,
                title: parsed.title,
                start_at: start.toISOString(),
                location: parsed.location ?? null,
                html_link: data?.htmlLink ?? null,
                maps_link: mapsLink,
                contact_name: parsed.contactName ?? null,
                remind_at: remindAt.toISOString(),
                status: "pending",
              };
              const rows: any[] = [];
              const clientPhone = (parsed.contactPhone ?? "").replace(/\D/g, "");
              const ownerPhone = (parsed.ownerPhone ?? "").replace(/\D/g, "");
              if (clientPhone) rows.push({ ...base, target: "client", phone: clientPhone });
              if (ownerPhone) rows.push({ ...base, target: "owner", phone: ownerPhone });
              if (rows.length && remindAt.getTime() > Date.now()) {
                const { error: insErr } = await sb
                  .from("crm_appointment_reminders")
                  .insert(rows);
                if (insErr) console.error(`[calendar] falha ao recriar lembretes: ${insErr.message}`);
                else remindersUpdated = rows.length;
              }
            } else {
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
            }
          } catch (e: any) {
            console.error(`[calendar] falha ao reajustar lembretes: ${e?.message ?? String(e)}`);
          }
        }


        // Aviso imediato ao cliente sobre a alteração (best-effort)
        let notified = false;
        let notifyError: string | null = null;
        if (parsed.notifyNow && parsed.contactPhone) {
          const data = start.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "America/Sao_Paulo",
          });
          const hora = start.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          });
          const text = [
            `Olá${parsed.contactName ? ` ${parsed.contactName}` : ""}! 👋`,
            ``,
            `Seu compromisso foi *atualizado*:`,
            ``,
            `📌 *${parsed.title}*`,
            `📅 ${data}`,
            `🕘 ${hora}`,
            parsed.location ? `📍 ${parsed.location}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          try {
            await sendWhatsApp(parsed.contactPhone, text);
            notified = true;
          } catch (e: any) {
            notifyError = e?.message ?? String(e);
            console.error(`[calendar] falha ao avisar alteração: ${notifyError}`);
          }
        }

        return Response.json({
          ok: true,
          notified,
          notifyError,
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

// POST /api/public/calendar/auto-book
// Agendamento automático (chamado pelo Robô via x-api-key, ou pelo CRM com JWT
// para teste). Cria o evento no Google Agenda com o prefixo "(a confirmar)",
// deixa os lembretes do CLIENTE pausados (nada é enviado a ele) e avisa o dono
// na hora por WhatsApp.
//
// Body: { phone, name?, startISO, durationMinutes?, title?, description?,
//         location?, reminderMinutes?, ownerPhone?, userId? }
// Aditivo: não altera nenhum fluxo existente.

import { createFileRoute } from "@tanstack/react-router";
import { buildShortMapsUrl } from "@/lib/maps-link";
import { z } from "zod";
import {
  checkApiKey,
  requireUserJwt,
  getSupabaseAdmin,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";
const INSTANCE = "zapcrm";
const DEFAULT_OWNER_PHONE = "5554991495959";
export const PENDING_PREFIX = "(a confirmar)";

const BodySchema = z.object({
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?\d+$/),
  name: z.string().trim().max(120).optional(),
  startISO: z.string().trim().min(10).max(40),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().max(300).optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  reminderMinutes: z.number().int().min(5).max(10080).optional(),
  ownerPhone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?\d+$/)
    .optional(),
  userId: z.string().uuid().optional(),
  // true = cria mesmo havendo conflito na agenda (padrão: bloqueia)
  allowConflict: z.boolean().optional(),
  // true = permite agendar no mesmo dia (padrão: exige 1 dia de antecedência)
  allowSameDay: z.boolean().optional(),

});

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

export const Route = createFileRoute("/api/public/calendar/auto-book")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        let userId: string | null = null;
        if (!checkApiKey(request)) {
          const auth = await requireUserJwt(request);
          if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
          userId = auth.userId;
        }

        const lovableKey = process.env.LOVABLE_API_KEY?.trim();
        const connKey = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
        if (!lovableKey || !connKey) {
          return jsonResponse(
            { ok: false, error: "Google Calendar não está conectado neste projeto" },
            500,
          );
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }

        const start = new Date(body.startISO);
        if (Number.isNaN(start.getTime())) {
          return jsonResponse({ ok: false, error: "data/hora inválida" }, 400);
        }
        if (start.getTime() < Date.now() - 60_000) {
          return jsonResponse({ ok: false, error: "data/hora no passado" }, 400);
        }

        // ── Antecedência mínima: nunca agendar no mesmo dia ───────────────
        try {
          const { violatesMinLead, findFreeSlots } = await import(
            "@/lib/calendar-availability.server"
          );
          if (!body.allowSameDay && violatesMinLead(start.toISOString())) {
            let slots: string[] = [];
            try {
              const r = await findFreeSlots({
                days: 7,
                durationMinutes: body.durationMinutes ?? 60,
                limit: 5,
              });
              slots = r.slots;
            } catch {
              /* sugestões são opcionais */
            }
            return jsonResponse(
              {
                ok: false,
                error: "agendamento exige no mínimo 1 dia de antecedência (não pode ser hoje)",
                minLead: true,
                suggestions: slots,
                suggestionsLocal: slots.map((s) => formatWhen(s)),
              },
              422,
            );
          }
        } catch (e: any) {
          console.error(`[auto-book] checagem de antecedência: ${e?.message ?? String(e)}`);
        }


        const sb = getSupabaseAdmin();

        // Dono da agenda: do JWT, do body, ou o primeiro usuário autorizado.
        if (!userId) {
          userId = body.userId ?? null;
          if (!userId) {
            const { data: allowed } = await sb
              .from("crm_allowed_users")
              .select("user_id")
              .order("created_at", { ascending: true })
              .limit(1);
            userId = allowed?.[0]?.user_id ?? null;
          }
        }
        if (!userId) {
          return jsonResponse({ ok: false, error: "nenhum usuário do CRM identificado" }, 400);
        }

        const phone = body.phone.replace(/\D/g, "");
        const durationMinutes = body.durationMinutes ?? 60;
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        const timeZone = body.timeZone || "America/Sao_Paulo";
        const baseTitle = body.title?.trim() || `Atendimento — ${body.name?.trim() || phone}`;
        const summary = `${PENDING_PREFIX} ${baseTitle}`;

        // ── Checagem de conflito na agenda do Google ──────────────────────
        if (!body.allowConflict) {
          try {
            const { checkConflict, findFreeSlots } = await import(
              "@/lib/calendar-availability.server"
            );
            const { free, conflicts } = await checkConflict(start.toISOString(), durationMinutes);
            if (!free) {
              const { slots } = await findFreeSlots({
                fromISO: start.toISOString(),
                days: 7,
                durationMinutes,
                limit: 5,
              });
              return jsonResponse(
                {
                  ok: false,
                  error: "conflito de horário na agenda",
                  conflict: true,
                  conflicts,
                  suggestions: slots,
                  suggestionsLocal: slots.map((s) => formatWhen(s)),
                },
                409,
              );
            }
          } catch (e: any) {
            // Falha na consulta não deve travar o agendamento.
            console.error(`[auto-book] checagem de conflito: ${e?.message ?? String(e)}`);
          }
        }

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
              summary,
              description: [body.description?.trim(), `Agendado pelo Robô • Cliente: ${phone}`]
                .filter(Boolean)
                .join("\n\n"),
              location: body.location || undefined,
              start: { dateTime: start.toISOString(), timeZone },
              end: { dateTime: end.toISOString(), timeZone },
              reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
            }),
          },
        );
        const text = await res.text();
        if (!res.ok) {
          console.error(`[auto-book] Google Calendar [${res.status}]: ${text}`);
          return jsonResponse(
            { ok: false, error: `Google Calendar [${res.status}]: ${text.slice(0, 400)}` },
            res.status,
          );
        }
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          /* sem JSON */
        }

        const mapsLink = buildShortMapsUrl(body.location);
        const ownerPhone = (body.ownerPhone ?? DEFAULT_OWNER_PHONE).replace(/\D/g, "");
        const reminderMinutes = body.reminderMinutes ?? 60;
        const remindAt = new Date(start.getTime() - reminderMinutes * 60_000);

        const base = {
          user_id: userId,
          event_id: data?.id ?? null,
          title: baseTitle,
          start_at: start.toISOString(),
          location: body.location ?? null,
          html_link: data?.htmlLink ?? null,
          maps_link: mapsLink,
          contact_name: body.name ?? null,
          remind_at: remindAt.toISOString(),
        };

        let remindersCreated = 0;
        if (remindAt.getTime() > Date.now()) {
          const rows = [
            // cliente: PAUSADO até você confirmar na Agenda
            { ...base, target: "client", phone, status: "paused" },
            { ...base, target: "owner", phone: ownerPhone, status: "pending" },
          ];
          const { error: insErr } = await sb.from("crm_appointment_reminders").insert(rows);
          if (insErr) console.error(`[auto-book] lembretes: ${insErr.message}`);
          else remindersCreated = rows.length;
        }

        // Aviso imediato ao dono (best-effort)
        let ownerNotified = false;
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        if (apiUrl && apiKey && ownerPhone) {
          const msg = [
            "🤖 *O Robô marcou um horário (a confirmar)*",
            ``,
            `📌 ${baseTitle}`,
            `📅 ${formatWhen(start.toISOString())}`,
            body.name ? `👤 Cliente: ${body.name} (${phone})` : `👤 Cliente: ${phone}`,
            body.location ? `📍 Endereço: ${body.location}` : "",
            "",
            "Confirme ou ajuste na tela Agenda do CRM. O cliente ainda não recebeu nada.",
          ]
            .filter(Boolean)
            .join("\n");
          try {
            const r = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ number: ownerPhone, text: msg , linkPreview: false }),
            });
            ownerNotified = r.ok;
            if (!r.ok) console.error(`[auto-book] aviso ao dono falhou [${r.status}]`);
          } catch (e: any) {
            console.error(`[auto-book] aviso ao dono: ${e?.message ?? String(e)}`);
          }
        }

        return jsonResponse({
          ok: true,
          id: data?.id ?? null,
          htmlLink: data?.htmlLink ?? null,
          start: start.toISOString(),
          pending: true,
          remindersCreated,
          ownerNotified,
        });
      },
    },
  },
});

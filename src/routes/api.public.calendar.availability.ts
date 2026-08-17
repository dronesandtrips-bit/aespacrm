// GET/POST /api/public/calendar/availability
// Consulta de horários livres na agenda do dono (Google Agenda).
// Auth: x-api-key (Robô/n8n) OU Bearer JWT do usuário logado.
// Aditivo: leitura apenas, não cria nada.
//
// GET  ?days=7&duration=60&from=ISO&limit=8&start=9&end=18
// POST { startISO, durationMinutes } -> { free, conflicts, suggestions }

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, requireUserJwt, PUBLIC_CORS, jsonResponse } from "@/integrations/supabase/server";

const CheckSchema = z.object({
  startISO: z.string().trim().min(10).max(40),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
});

async function authorize(request: Request) {
  if (checkApiKey(request)) return null;
  const auth = await requireUserJwt(request);
  if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, auth.status);
  return null;
}

export const Route = createFileRoute("/api/public/calendar/availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),

      GET: async ({ request }) => {
        const denied = await authorize(request);
        if (denied) return denied;

        const url = new URL(request.url);
        const num = (k: string, d: number) => {
          const v = Number(url.searchParams.get(k));
          return Number.isFinite(v) && v > 0 ? v : d;
        };
        try {
          const { findFreeSlots } = await import("@/lib/calendar-availability.server");
          const { slots, preferredSlots, busy } = await findFreeSlots({
            fromISO: url.searchParams.get("from") ?? undefined,
            days: num("days", 7),
            durationMinutes: num("duration", 60),
            limit: num("limit", 8),
            workStartHour: num("start", 9),
            workEndHour: num("end", 18),
            skipWeekends: url.searchParams.get("weekends") !== "1",
            // ?only=1 devolve apenas os horários preferidos (9h e 14h)
            preferredOnly: url.searchParams.get("only") === "1",
            // antecedência mínima em dias (padrão 1 = nunca hoje)
            minLeadDays: url.searchParams.has("lead") ? num("lead", 1) : undefined,
          });
          return jsonResponse({
            ok: true,
            slots,
            preferredSlots,
            slotsLocal: slots.map((s) =>

              new Date(s).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              }),
            ),
            busy,
          });
        } catch (e: any) {
          return jsonResponse({ ok: false, error: e?.message ?? String(e) }, 500);
        }
      },

      POST: async ({ request }) => {
        const denied = await authorize(request);
        if (denied) return denied;

        let body: z.infer<typeof CheckSchema>;
        try {
          body = CheckSchema.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }
        const duration = body.durationMinutes ?? 60;
        try {
          const { checkConflict, findFreeSlots, violatesMinLead } = await import(
            "@/lib/calendar-availability.server"
          );
          const tooSoon = violatesMinLead(body.startISO);
          const c = await checkConflict(body.startISO, duration);
          const conflicts = c.conflicts;
          const free = c.free && !tooSoon;
          let suggestions: string[] = [];
          if (!free) {
            const r = await findFreeSlots({
              fromISO: tooSoon ? undefined : body.startISO,
              days: 7,
              durationMinutes: duration,
              limit: 5,
            });
            suggestions = r.slots;
          }
          return jsonResponse({
            ok: true,
            free,
            tooSoon,
            conflicts,
            suggestions,
            suggestionsLocal: suggestions.map((s) =>
              new Date(s).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              }),
            ),
          });
        } catch (e: any) {
          return jsonResponse({ ok: false, error: e?.message ?? String(e) }, 500);
        }
      },
    },
  },
});

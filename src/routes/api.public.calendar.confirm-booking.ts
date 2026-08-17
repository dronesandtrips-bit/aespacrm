// POST /api/public/calendar/confirm-booking
// Confirma um agendamento feito automaticamente pelo Robô: remove o prefixo
// "(a confirmar)" do evento no Google Agenda e ativa os lembretes do cliente
// (status paused -> pending).
//
// Body: { eventId }
// Auth: Bearer JWT do usuário logado OU x-api-key.

import { createFileRoute } from "@tanstack/react-router";
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
const PENDING_PREFIX = "(a confirmar)";

const BodySchema = z.object({ eventId: z.string().trim().min(1).max(200) });

export const Route = createFileRoute("/api/public/calendar/confirm-booking")({
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
          return jsonResponse({ ok: false, error: "Google Calendar não conectado" }, 500);
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }

        const url = `${GATEWAY_URL}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(body.eventId)}`;
        const headers = {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": connKey,
          "Content-Type": "application/json",
        };

        const getRes = await fetch(url, { headers });
        const getText = await getRes.text();
        if (!getRes.ok) {
          return jsonResponse(
            { ok: false, error: `Google Calendar [${getRes.status}]: ${getText.slice(0, 300)}` },
            getRes.status,
          );
        }
        let ev: any = null;
        try {
          ev = JSON.parse(getText);
        } catch {
          /* ignore */
        }

        const cleanTitle = String(ev?.summary ?? "")
          .replace(PENDING_PREFIX, "")
          .trim();
        if (ev?.summary && ev.summary !== cleanTitle) {
          const patch = await fetch(url, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ summary: cleanTitle }),
          });
          if (!patch.ok) {
            const t = await patch.text();
            console.error(`[confirm-booking] PATCH falhou [${patch.status}]: ${t.slice(0, 300)}`);
          }
        }

        // Ativa os lembretes pausados do cliente
        let remindersActivated = 0;
        try {
          const sb = getSupabaseAdmin();
          let q = sb
            .from("crm_appointment_reminders")
            .update({ status: "pending" })
            .eq("event_id", body.eventId)
            .eq("status", "paused")
            .select("id");
          if (userId) q = q.eq("user_id", userId);
          const { data, error } = await q;
          if (error) console.error(`[confirm-booking] lembretes: ${error.message}`);
          else remindersActivated = data?.length ?? 0;
        } catch (e: any) {
          console.error(`[confirm-booking] ${e?.message ?? String(e)}`);
        }

        return jsonResponse({ ok: true, title: cleanTitle, remindersActivated });
      },
    },
  },
});

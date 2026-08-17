// POST /api/public/calendar/detect-test
// Testa o detector de agendamentos do Robô sem depender do WhatsApp.
//
// Body: { text, phone?, name?, create?: boolean }
// - create=false (padrão): apenas simula (não cria nada)
// - create=true: cria de verdade o evento "(a confirmar)" via auto-book
//
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
import { detectAppointment } from "@/lib/appointment-detect";
import { maybeAutoBookFromBotMessage } from "@/lib/auto-book-from-bot.server";

const BodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  phone: z.string().trim().max(30).optional(),
  name: z.string().trim().max(120).optional(),
  create: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/calendar/detect-test")({
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

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return jsonResponse({ ok: false, error: "Dados inválidos" }, 400);
        }
        const { text, phone, name, create } = parsed.data;

        const enabled =
          !["off", "0", "false"].includes(
            (process.env.ZAPCRM_AUTO_BOOK ?? "").trim().toLowerCase(),
          );

        const hit = detectAppointment(text);
        if (!hit) {
          return jsonResponse({
            ok: true,
            enabled,
            detected: false,
            reason:
              "Nenhum agendamento reconhecido — a mensagem precisa ter palavra de confirmação + hora + dia.",
          });
        }

        const digits = (phone ?? "").replace(/\D/g, "");
        let duplicate = false;
        let created = false;
        let createError: string | null = null;

        if (userId && digits) {
          const sb = getSupabaseAdmin();
          const start = new Date(hit.startISO);
          const { data: dup } = await sb
            .from("crm_appointment_reminders")
            .select("id")
            .eq("user_id", userId)
            .eq("phone", digits)
            .gte("start_at", new Date(start.getTime() - 30 * 60_000).toISOString())
            .lte("start_at", new Date(start.getTime() + 30 * 60_000).toISOString())
            .limit(1);
          duplicate = Boolean(dup?.length);

          if (create && !duplicate) {
            try {
              await maybeAutoBookFromBotMessage({
                sb,
                userId,
                phone: digits,
                name: name ?? null,
                text,
              });
              created = true;
            } catch (e: any) {
              createError = e?.message ?? String(e);
            }
          }
        }

        return jsonResponse({
          ok: true,
          enabled,
          detected: true,
          startISO: hit.startISO,
          matched: hit.matched,
          duplicate,
          created,
          createError,
        });
      },
    },
  },
});

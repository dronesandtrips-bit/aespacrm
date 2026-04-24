// POST /api/public/sequences/sent
// n8n notifica que enviou uma mensagem. Avança o contato para o próximo step
// (ou marca completed) e calcula o próximo next_send_at.
// Body: { contact_sequence_id: string, status?: "sent"|"failed", error?: string }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";

const Schema = z.object({
  contact_sequence_id: z.string().uuid(),
  status: z.enum(["sent", "failed"]).default("sent"),
  error: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/sequences/sent")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        try {
          const body = await request.json();
          const parsed = Schema.safeParse(body);
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid body", details: parsed.error.format() }, 400);
          }
          const { contact_sequence_id, status, error: errMsg } = parsed.data;
          const admin = getSupabaseAdmin();

          const { data: cs, error: csErr } = await admin
            .from("crm_contact_sequences")
            .select("id,user_id,contact_id,sequence_id,current_step,status")
            .eq("id", contact_sequence_id)
            .single();
          if (csErr || !cs) {
            return jsonResponse({ error: "contact_sequence not found" }, 404);
          }
          if (cs.status !== "active") {
            return jsonResponse({ ok: true, skipped: true, reason: cs.status });
          }

          const { data: steps, error: stErr } = await admin
            .from("crm_sequence_steps")
            .select('"order",message,delay_value,delay_unit')
            .eq("sequence_id", cs.sequence_id)
            .order("order", { ascending: true });
          if (stErr) throw stErr;

          const currentStep = (steps ?? []).find((s: any) => s.order === cs.current_step);
          // Loga tentativa
          await admin.from("crm_sequence_send_log").insert({
            user_id: cs.user_id,
            contact_sequence_id: cs.id,
            step_order: cs.current_step,
            message: currentStep?.message ?? "",
            status,
            error: errMsg ?? null,
          });

          if (status === "failed") {
            // Não avança; reagenda 30min à frente para retry
            await admin
              .from("crm_contact_sequences")
              .update({ next_send_at: new Date(Date.now() + 30 * 60_000).toISOString() })
              .eq("id", cs.id);
            return jsonResponse({ ok: true, retry_in_minutes: 30 });
          }

          const nextOrder = cs.current_step + 1;
          const nextStep = (steps ?? []).find((s: any) => s.order === nextOrder);
          if (!nextStep) {
            await admin
              .from("crm_contact_sequences")
              .update({ status: "completed", next_send_at: null })
              .eq("id", cs.id);
            return jsonResponse({ ok: true, completed: true });
          }
          const ms =
            nextStep.delay_value *
            (nextStep.delay_unit === "hours" ? 3600_000 : 86_400_000);
          await admin
            .from("crm_contact_sequences")
            .update({
              current_step: nextOrder,
              next_send_at: new Date(Date.now() + ms).toISOString(),
            })
            .eq("id", cs.id);
          return jsonResponse({ ok: true, next_step: nextOrder });
        } catch (err: any) {
          console.error("[sequences/sent]", err);
          return jsonResponse({ error: err?.message ?? "Internal error" }, 500);
        }
      },
    },
  },
});

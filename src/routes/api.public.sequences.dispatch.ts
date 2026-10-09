// Private n8n checkpoint: reserve before contacting Evolution; acknowledge
// only after the successful send has been recorded by sequences/sent.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";
import { isDefinitiveInvalidNumber } from "@/lib/sequence-dispatch-response";

const DispatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), contact_sequence_id: z.string().uuid(), step_order: z.number().int().min(0), occurrence_id: z.string().uuid().optional() }),
  z.object({ action: z.literal("acknowledge"), claim_id: z.string().uuid() }),
  z.object({ action: z.literal("reject_invalid_number"), claim_id: z.string().uuid(), response: z.unknown() }),
]);

export const Route = createFileRoute("/api/public/sequences/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiKey(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        const parsed = DispatchSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return jsonResponse({ error: "Invalid body" }, 400);
        if (parsed.data.action === "reject_invalid_number" && !isDefinitiveInvalidNumber(parsed.data.response)) {
          return jsonResponse({ ok: false, reason: "not_definitive" }, 409);
        }
        const admin = getSupabaseAdmin();
        if (parsed.data.action === "reserve" && !parsed.data.occurrence_id) {
          const { data: cs, error: csError } = await admin.from("crm_contact_sequences")
            .select("sequence_id").eq("id", parsed.data.contact_sequence_id).maybeSingle();
          if (csError) return jsonResponse({ error: "Dispatch checkpoint unavailable" }, 503);
          if (cs) {
            const { data: sequence, error: sequenceError } = await admin.from("crm_sequences").select("*").eq("id", cs.sequence_id).maybeSingle();
            if (sequenceError) return jsonResponse({ error: "Dispatch checkpoint unavailable" }, 503);
            if (sequence?.recurrence_enabled) return jsonResponse({ ok: false, reason: "occurrence_required" }, 409);
          }
        }
        let recurringClaim = false;
        if (parsed.data.action !== "reserve") {
          const { data: claim, error: claimError } = await admin.from("crm_sequence_dispatches").select("*").eq("id", parsed.data.claim_id).maybeSingle();
          if (claimError) return jsonResponse({ error: "Dispatch checkpoint unavailable" }, 503);
          recurringClaim = Boolean(claim?.occurrence_id);
        }
        const { data, error } = parsed.data.action === "reserve"
          ? parsed.data.occurrence_id ? await admin.rpc("crm_reserve_recurring_dispatch", {
              p_contact_sequence_id: parsed.data.contact_sequence_id,
              p_step_order: parsed.data.step_order,
              p_occurrence_id: parsed.data.occurrence_id,
            }) : await admin.rpc("crm_reserve_sequence_dispatch", {
              p_contact_sequence_id: parsed.data.contact_sequence_id,
              p_step_order: parsed.data.step_order,
            })
          : parsed.data.action === "acknowledge"
            ? await admin.rpc(recurringClaim ? "crm_acknowledge_recurring_dispatch" : "crm_acknowledge_sequence_dispatch", { p_claim_id: parsed.data.claim_id })
            : await admin.rpc(recurringClaim ? "crm_reject_invalid_recurring_dispatch" : "crm_reject_invalid_sequence_dispatch", {
                p_claim_id: parsed.data.claim_id,
                p_error: "Número não existe no WhatsApp (Evolution: 400, exists:false)",
              });
        if (error) {
          console.error("[sequences/dispatch]", error);
          return jsonResponse({ error: "Dispatch checkpoint unavailable" }, 503);
        }
        if (parsed.data.action !== "reserve" && !data?.ok) {
          return jsonResponse(data ?? { error: "Dispatch not acknowledged" }, 409);
        }
        return jsonResponse(data);
      },
    },
  },
});
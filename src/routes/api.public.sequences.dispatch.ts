// Private n8n checkpoint: reserve before contacting Evolution; acknowledge
// only after the successful send has been recorded by sequences/sent.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const DispatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), contact_sequence_id: z.string().uuid(), step_order: z.number().int().min(0) }),
  z.object({ action: z.literal("acknowledge"), claim_id: z.string().uuid() }),
  z.object({ action: z.literal("reject_invalid_number"), claim_id: z.string().uuid(), response: z.unknown() }),
]);

// A response without BOTH the definitive HTTP 400 and Evolution's explicit
// exists:false stays reserved. In particular, timeouts/5xx never pass here.
function isDefinitiveInvalidNumber(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (response.ok !== false || Number(response.status) !== 400) return false;
  const hasExplicitRejection = (part: unknown, depth = 0): boolean => {
    if (depth > 8 || part == null) return false;
    if (typeof part === "string") {
      try { return hasExplicitRejection(JSON.parse(part), depth + 1); } catch { return false; }
    }
    if (typeof part !== "object") return false;
    if (Array.isArray(part)) return part.some((item) => hasExplicitRejection(item, depth + 1));
    const object = part as Record<string, unknown>;
    return object.exists === false || Object.values(object).some((item) => hasExplicitRejection(item, depth + 1));
  };
  return hasExplicitRejection(response.error);
}

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
        const { data, error } = parsed.data.action === "reserve"
          ? await admin.rpc("crm_reserve_sequence_dispatch", {
              p_contact_sequence_id: parsed.data.contact_sequence_id,
              p_step_order: parsed.data.step_order,
            })
          : parsed.data.action === "acknowledge"
            ? await admin.rpc("crm_acknowledge_sequence_dispatch", { p_claim_id: parsed.data.claim_id })
            : await admin.rpc("crm_reject_invalid_sequence_dispatch", {
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
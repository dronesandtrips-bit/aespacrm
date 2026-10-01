// Private n8n checkpoint: reserve before contacting Evolution; acknowledge
// only after the successful send has been recorded by sequences/sent.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const DispatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), contact_sequence_id: z.string().uuid(), step_order: z.number().int().min(0) }),
  z.object({ action: z.literal("acknowledge"), claim_id: z.string().uuid() }),
]);

export const Route = createFileRoute("/api/public/sequences/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiKey(request)) return jsonResponse({ error: "Unauthorized" }, 401);
        const parsed = DispatchSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return jsonResponse({ error: "Invalid body" }, 400);
        const admin = getSupabaseAdmin();
        const { data, error } = parsed.data.action === "reserve"
          ? await admin.rpc("crm_reserve_sequence_dispatch", {
              p_contact_sequence_id: parsed.data.contact_sequence_id,
              p_step_order: parsed.data.step_order,
            })
          : await admin.rpc("crm_acknowledge_sequence_dispatch", { p_claim_id: parsed.data.claim_id });
        if (error) {
          console.error("[sequences/dispatch]", error);
          return jsonResponse({ error: "Dispatch checkpoint unavailable" }, 503);
        }
        if (parsed.data.action === "acknowledge" && !data?.ok) {
          return jsonResponse(data ?? { error: "Dispatch not acknowledged" }, 409);
        }
        return jsonResponse(data);
      },
    },
  },
});
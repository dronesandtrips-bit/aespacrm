// POST /api/public/ai/log-enrich
// Registra que o usuário disparou um enriquecimento (botão ✨).
// Retorna { log_id } que deve ser repassado ao n8n para que o callback
// /api/public/ai/contact-enrich possa fechar o log com status=success/error.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

const BodySchema = z.object({
  contact_id: z.string().uuid(),
  contact_name: z.string().max(200).optional().nullable(),
  contact_phone: z.string().max(32).optional().nullable(),
  request_payload: z.record(z.string(), z.any()).optional().nullable(),
});

export const Route = createFileRoute("/api/public/ai/log-enrich")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();
        if (!ownerUserId) {
          return jsonResponse(
            { ok: false, error: "EVOLUTION_OWNER_USER_ID não configurado" },
            500,
          );
        }

        let raw: any;
        try {
          raw = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid json" }, 400);
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(
            { ok: false, error: "invalid body", details: parsed.error.flatten() },
            400,
          );
        }

        const sb = getSupabaseAdmin();
        const { data, error } = await sb
          .from("crm_ai_enrichment_logs")
          .insert({
            user_id: ownerUserId,
            contact_id: parsed.data.contact_id,
            contact_name: parsed.data.contact_name ?? null,
            contact_phone: parsed.data.contact_phone ?? null,
            request_payload: parsed.data.request_payload ?? null,
            status: "dispatched",
            triggered_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (error) {
          console.error("log-enrich insert error", error);
          return jsonResponse({ ok: false, error: error.message }, 500);
        }

        return jsonResponse({ ok: true, log_id: data.id });
      },
    },
  },
});

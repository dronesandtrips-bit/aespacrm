// POST /api/public/ai/contact-enrich-failure
// n8n chama este endpoint no caminho de erro do workflow para marcar
// o log de enriquecimento como `error` com a mensagem real.
//
// Body:
// {
//   "log_id": "uuid",            // opcional: se ausente, usa o último 'dispatched' do contato
//   "contact_id": "uuid",        // OU phone (necessário se log_id ausente)
//   "phone": "5511999999999",
//   "error_message": "The service was not able to process your request",
//   "node_name": "Classify With Lovable AI"   // opcional, contextual
// }
//
// Segurança: header `x-api-key` = N8N_API_KEY.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkApiKey,
  getSupabaseAdmin,
  jsonResponse,
  PUBLIC_CORS,
} from "@/integrations/supabase/server";

const BodySchema = z
  .object({
    log_id: z.string().uuid().optional().nullable(),
    contact_id: z.string().uuid().optional().nullable(),
    phone: z.string().min(3).max(40).optional().nullable(),
    error_message: z.string().min(1).max(2000),
    node_name: z.string().max(200).optional().nullable(),
  })
  .refine((d) => !!(d.log_id || d.contact_id || d.phone), {
    message: "log_id, contact_id ou phone é obrigatório",
  });

function normalizePhone(p: string) {
  return p.replace(/\D/g, "");
}

export const Route = createFileRoute("/api/public/ai/contact-enrich-failure")({
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
        const { log_id, contact_id, phone, error_message, node_name } = parsed.data;
        const sb = getSupabaseAdmin();

        // Resolve contact_id se veio só telefone
        let resolvedContactId = contact_id ?? null;
        if (!resolvedContactId && phone) {
          const phoneNorm = normalizePhone(phone);
          const { data: c } = await sb
            .from("crm_contacts")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("phone_norm", phoneNorm)
            .maybeSingle();
          resolvedContactId = c?.id ?? null;
        }

        // Determina qual log atualizar
        let targetLogId = log_id ?? null;
        if (!targetLogId && resolvedContactId) {
          const { data: latestLog } = await sb
            .from("crm_ai_enrichment_logs")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("contact_id", resolvedContactId)
            .eq("status", "dispatched")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          targetLogId = latestLog?.id ?? null;
        }

        if (!targetLogId) {
          return jsonResponse(
            { ok: false, error: "log_pendente_não_encontrado" },
            404,
          );
        }

        const fullMessage = node_name
          ? `[${node_name}] ${error_message}`
          : error_message;

        const { error: upErr } = await sb
          .from("crm_ai_enrichment_logs")
          .update({
            status: "error",
            error_message: fullMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", targetLogId)
          .eq("user_id", ownerUserId);

        if (upErr) {
          console.error("contact-enrich-failure update error", upErr);
          return jsonResponse({ ok: false, error: upErr.message }, 500);
        }

        return jsonResponse({ ok: true, log_id: targetLogId });
      },
    },
  },
});

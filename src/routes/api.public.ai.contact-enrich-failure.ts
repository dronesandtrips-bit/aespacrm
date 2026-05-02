// POST /api/public/ai/contact-enrich-failure
// Webhook chamado pelo n8n quando o pipeline de enriquecimento falha
// (timeout da IA, erro de parse, etc.). Marca o log de enriquecimento
// como "error" para sair do estado "Disparado" infinito.
//
// Body:
// {
//   "log_id": "uuid",            // opcional — se vier, marca esse log direto
//   "contact_id": "uuid",        // opcional — fallback: marca o log mais recente "dispatched" desse contato
//   "error_message": "string",   // mensagem de erro (até 2000 chars)
//   "node_name": "string"        // opcional — qual nó do n8n falhou
// }
//
// Segurança: header `x-api-key` igual ao N8N_API_KEY.

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
    error_message: z.string().max(2000).optional().nullable(),
    node_name: z.string().max(120).optional().nullable(),
  })
  .refine((d) => !!(d.log_id || d.contact_id), {
    message: "log_id ou contact_id é obrigatório",
  });

export const Route = createFileRoute("/api/public/ai/contact-enrich-failure")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),
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

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid json" }, 400);
        }

        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(
            { ok: false, error: parsed.error.errors[0]?.message ?? "bad input" },
            400,
          );
        }
        const data = parsed.data;

        const sb = getSupabaseAdmin();
        const errorMessage =
          (data.error_message ?? "").slice(0, 2000) ||
          `n8n pipeline failure${data.node_name ? ` em ${data.node_name}` : ""}`;
        const fullMessage = data.node_name
          ? `[${data.node_name}] ${errorMessage}`
          : errorMessage;

        let updatedCount = 0;

        if (data.log_id) {
          const { error, count } = await sb
            .from("crm_ai_enrichment_logs")
            .update({
              status: "error",
              error_message: fullMessage,
              completed_at: new Date().toISOString(),
            })
            .eq("id", data.log_id)
            .eq("user_id", ownerUserId)
            .select("id", { count: "exact" });
          if (error) {
            console.error("contact-enrich-failure update by log_id", error);
            return jsonResponse({ ok: false, error: error.message }, 500);
          }
          updatedCount = count ?? 0;
        } else if (data.contact_id) {
          // Marca o log mais recente "dispatched" desse contato como erro.
          const { data: rows, error: selErr } = await sb
            .from("crm_ai_enrichment_logs")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("contact_id", data.contact_id)
            .eq("status", "dispatched")
            .order("created_at", { ascending: false })
            .limit(1);
          if (selErr) {
            console.error("contact-enrich-failure select", selErr);
            return jsonResponse({ ok: false, error: selErr.message }, 500);
          }
          const target = rows?.[0]?.id;
          if (target) {
            const { error, count } = await sb
              .from("crm_ai_enrichment_logs")
              .update({
                status: "error",
                error_message: fullMessage,
                completed_at: new Date().toISOString(),
              })
              .eq("id", target)
              .eq("user_id", ownerUserId)
              .select("id", { count: "exact" });
            if (error) {
              console.error("contact-enrich-failure update by contact", error);
              return jsonResponse({ ok: false, error: error.message }, 500);
            }
            updatedCount = count ?? 0;
          }
        }

        return jsonResponse({ ok: true, updated: updatedCount });
      },
    },
  },
});

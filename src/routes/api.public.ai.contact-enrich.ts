// POST /api/public/ai/contact-enrich
// Webhook chamado pelo n8n para enriquecer contatos com dados de IA.
//
// Body esperado:
// {
//   "phone": "5511999999999",
//   "ai_summary": "Lead interessado em câmeras Wi-Fi para residência",
//   "category_name": "Cliente Câmeras Wi-Fi",
//   "urgency": "Alta"  // Baixa | Média | Alta
// }
//
// Segurança: header `x-api-key` igual ao N8N_API_KEY.
// Multi-tenant: usa EVOLUTION_OWNER_USER_ID como dono do tenant ZapCRM.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkApiKey, getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const BodySchema = z.object({
  phone: z.string().min(6).max(32),
  ai_summary: z.string().max(4000).optional().nullable(),
  category_name: z.string().min(1).max(120).optional().nullable(),
  urgency: z.enum(["Baixa", "Média", "Alta", "Media"]).optional().nullable(),
});

function normalizePhone(p: string) {
  return p.replace(/\D/g, "");
}

export const Route = createFileRoute("/api/public/ai/contact-enrich")({
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
        const { phone, ai_summary, category_name } = parsed.data;
        // Normaliza "Media" → "Média" (acentos podem perder no transporte)
        const urgency = parsed.data.urgency === "Media" ? "Média" : parsed.data.urgency ?? null;

        const sb = getSupabaseAdmin();
        const phoneNorm = normalizePhone(phone);
        if (!phoneNorm) {
          return jsonResponse({ ok: false, error: "phone inválido" }, 400);
        }

        // Localiza contato (phone_norm preferencial, fallback em phone bruto)
        const { data: contact, error: findErr } = await sb
          .from("crm_contacts")
          .select("id, category_id")
          .eq("user_id", ownerUserId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();
        if (findErr) {
          console.error("contact-enrich find error", findErr);
          return jsonResponse({ ok: false, error: findErr.message }, 500);
        }
        if (!contact) {
          return jsonResponse(
            { ok: false, error: "contato não encontrado", phone: phoneNorm },
            404,
          );
        }

        // Resolve category_id pelo nome (case-insensitive), se enviado
        let categoryId: string | null = null;
        if (category_name) {
          const { data: cats } = await sb
            .from("crm_categories")
            .select("id, name")
            .eq("user_id", ownerUserId);
          const found = (cats ?? []).find(
            (c: any) => String(c.name).trim().toLowerCase() === category_name.trim().toLowerCase(),
          );
          categoryId = found?.id ?? null;
        }

        const patch: Record<string, unknown> = {
          last_ai_sync: new Date().toISOString(),
        };
        if (ai_summary !== undefined) patch.ai_persona_summary = ai_summary;
        if (urgency) patch.urgency_level = urgency;
        if (categoryId) patch.category_id = categoryId;

        const { error: upErr } = await sb
          .from("crm_contacts")
          .update(patch)
          .eq("id", contact.id)
          .eq("user_id", ownerUserId);
        if (upErr) {
          console.error("contact-enrich update error", upErr);
          return jsonResponse({ ok: false, error: upErr.message }, 500);
        }

        return jsonResponse({
          ok: true,
          contact_id: contact.id,
          updated: {
            ai_persona_summary: ai_summary !== undefined,
            urgency_level: !!urgency,
            category_id: categoryId,
          },
        });
      },
    },
  },
});

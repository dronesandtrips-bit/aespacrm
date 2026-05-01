// POST /api/public/ai/contact-enrich
// Webhook chamado pelo n8n para enriquecer contatos com dados de IA.
//
// Body esperado (todos os campos opcionais, exceto phone):
// {
//   "phone": "5511999999999",
//   "ai_summary": "Lead interessado em câmeras Wi-Fi para residência",
//   "category_name": "Cliente Câmeras Wi-Fi",        // legado, single
//   "category_names": ["Alarme", "Câmeras"],         // novo, múltiplas tags
//   "mode": "merge" | "replace",                     // default: "merge"
//   "urgency": "Alta"                                // Baixa | Média | Alta
// }
//
// Comportamento de categorias:
//   - mode=merge   (default): adiciona as tags enviadas às já existentes.
//   - mode=replace: substitui TODAS as tags do contato pelas enviadas.
//   - Tags desconhecidas (nome não cadastrado) são ignoradas silenciosamente
//     e retornadas em `unknown_categories`.
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
  category_names: z.array(z.string().min(1).max(120)).max(50).optional().nullable(),
  mode: z.enum(["merge", "replace"]).optional().default("merge"),
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
        const { phone, ai_summary, category_name, category_names, mode } = parsed.data;
        // Normaliza "Media" → "Média" (acentos podem perder no transporte)
        const urgency = parsed.data.urgency === "Media" ? "Média" : parsed.data.urgency ?? null;

        const sb = getSupabaseAdmin();
        const phoneNorm = normalizePhone(phone);
        if (!phoneNorm) {
          return jsonResponse({ ok: false, error: "phone inválido" }, 400);
        }

        // Localiza contato
        const { data: contact, error: findErr } = await sb
          .from("crm_contacts")
          .select("id")
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

        // ----- Resolve nomes de categorias enviados → IDs -----
        const incomingNames: string[] = [];
        if (Array.isArray(category_names)) incomingNames.push(...category_names);
        if (category_name) incomingNames.push(category_name);
        const normalizedIncoming = Array.from(
          new Set(incomingNames.map((n) => n.trim()).filter(Boolean)),
        );

        let resolvedIds: string[] = [];
        const unknownCategories: string[] = [];
        if (normalizedIncoming.length > 0) {
          const { data: cats } = await sb
            .from("crm_categories")
            .select("id, name")
            .eq("user_id", ownerUserId);
          const byName = new Map(
            (cats ?? []).map((c: any) => [String(c.name).trim().toLowerCase(), c.id]),
          );
          for (const name of normalizedIncoming) {
            const id = byName.get(name.toLowerCase());
            if (id) resolvedIds.push(id);
            else unknownCategories.push(name);
          }
          resolvedIds = Array.from(new Set(resolvedIds));
        }

        // ----- Aplica patch em campos simples -----
        const patch: Record<string, unknown> = {
          last_ai_sync: new Date().toISOString(),
        };
        if (ai_summary !== undefined) patch.ai_persona_summary = ai_summary;
        if (urgency) patch.urgency_level = urgency;

        const { error: upErr } = await sb
          .from("crm_contacts")
          .update(patch)
          .eq("id", contact.id)
          .eq("user_id", ownerUserId);
        if (upErr) {
          console.error("contact-enrich update error", upErr);
          return jsonResponse({ ok: false, error: upErr.message }, 500);
        }

        // ----- Aplica categorias (merge ou replace) -----
        let categoriesAdded = 0;
        let categoriesRemoved = 0;
        let finalCategoryIds: string[] = [];

        if (normalizedIncoming.length > 0) {
          // Lê as tags atuais
          const { data: current } = await sb
            .from("crm_contact_categories")
            .select("category_id")
            .eq("contact_id", contact.id);
          const currentIds = new Set((current ?? []).map((r: any) => r.category_id));

          let targetIds: Set<string>;
          if (mode === "replace") {
            targetIds = new Set(resolvedIds);
          } else {
            // merge
            targetIds = new Set([...currentIds, ...resolvedIds]);
          }

          const toInsert = [...targetIds].filter((id) => !currentIds.has(id));
          const toDelete =
            mode === "replace"
              ? [...currentIds].filter((id) => !targetIds.has(id))
              : [];

          if (toInsert.length) {
            const rows = toInsert.map((cid) => ({
              contact_id: contact.id,
              category_id: cid,
              user_id: ownerUserId,
            }));
            const { error: insErr } = await sb
              .from("crm_contact_categories")
              .insert(rows);
            if (insErr) {
              console.error("contact-enrich insert categories", insErr);
              return jsonResponse({ ok: false, error: insErr.message }, 500);
            }
            categoriesAdded = toInsert.length;
          }
          if (toDelete.length) {
            const { error: delErr } = await sb
              .from("crm_contact_categories")
              .delete()
              .eq("contact_id", contact.id)
              .in("category_id", toDelete);
            if (delErr) {
              console.error("contact-enrich delete categories", delErr);
              return jsonResponse({ ok: false, error: delErr.message }, 500);
            }
            categoriesRemoved = toDelete.length;
          }
          finalCategoryIds = [...targetIds];
          // O trigger no DB sincroniza crm_contacts.category_id automaticamente
          // (espelho da 1ª tag por created_at).
        }

        return jsonResponse({
          ok: true,
          contact_id: contact.id,
          mode,
          updated: {
            ai_persona_summary: ai_summary !== undefined,
            urgency_level: !!urgency,
            categories_added: categoriesAdded,
            categories_removed: categoriesRemoved,
            final_category_ids: finalCategoryIds,
            unknown_categories: unknownCategories,
          },
        });
      },
    },
  },
});

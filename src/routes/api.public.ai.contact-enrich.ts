// POST /api/public/ai/contact-enrich
// Webhook chamado pelo n8n para enriquecer contatos com dados de IA.
//
// Body esperado:
// {
//   "contact_id": "uuid",                       // OU phone (um dos dois é obrigatório)
//   "phone": "5511999999999",
//   "name": "Nome Identificado",                // opcional, atualiza crm_contacts.name
//   "ai_summary": "...",                        // legado
//   "resumo_ia": "...",                         // alias de ai_summary (PT)
//   "persona_ia": "Lead Qualificado",           // opcional → crm_contacts.ai_persona_label
//   "category_name": "Cliente Câmeras Wi-Fi",   // legado, single
//   "category_names": ["Alarme", "Câmeras"],    // múltiplas tags
//   "mode": "merge" | "replace",                // default "merge"
//   "urgency": "Alta",                          // Baixa | Média | Alta
//   "urgencia": "Alta"                          // alias PT
// }
//
// Comportamento de categorias:
//   - mode=merge   (default): adiciona as tags enviadas às já existentes.
//   - mode=replace: substitui TODAS as tags do contato pelas enviadas.
//   - Categorias com nome inexistente são CRIADAS automaticamente.
//   - A 1ª categoria do array (índice 0) é espelhada em crm_contacts.category_id.
//
// Segurança: header `x-api-key` igual ao N8N_API_KEY.
// Multi-tenant: usa EVOLUTION_OWNER_USER_ID como dono do tenant ZapCRM.

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
    phone: z.string().min(6).max(32).optional().nullable(),
    name: z.string().min(1).max(200).optional().nullable(),
    ai_summary: z.string().max(4000).optional().nullable(),
    resumo_ia: z.string().max(4000).optional().nullable(),
    persona_ia: z.string().max(200).optional().nullable(),
    category_name: z.string().min(1).max(120).optional().nullable(),
    category_names: z.array(z.string().min(1).max(120)).max(50).optional().nullable(),
    mode: z.enum(["merge", "replace"]).optional().default("merge"),
    urgency: z.enum(["Baixa", "Média", "Alta", "Media"]).optional().nullable(),
    urgencia: z.enum(["Baixa", "Média", "Alta", "Media"]).optional().nullable(),
  })
  .refine((d) => !!(d.contact_id || d.phone), {
    message: "contact_id ou phone é obrigatório",
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
        const {
          log_id,
          contact_id,
          phone,
          name,
          ai_summary,
          resumo_ia,
          persona_ia,
          category_name,
          category_names,
          mode,
        } = parsed.data;

        const urgencyRaw = parsed.data.urgency ?? parsed.data.urgencia ?? null;
        const urgency = urgencyRaw === "Media" ? "Média" : urgencyRaw;
        const summary = ai_summary ?? resumo_ia ?? undefined;

        const sb = getSupabaseAdmin();

        // -------- Localiza contato (por id ou phone) --------
        let contactId: string | null = null;
        if (contact_id) {
          const { data, error } = await sb
            .from("crm_contacts")
            .select("id")
            .eq("id", contact_id)
            .eq("user_id", ownerUserId)
            .maybeSingle();
          if (error) {
            console.error("contact-enrich find by id error", error);
            return jsonResponse({ ok: false, error: error.message }, 500);
          }
          contactId = data?.id ?? null;
        } else if (phone) {
          const phoneNorm = normalizePhone(phone);
          if (!phoneNorm) {
            return jsonResponse({ ok: false, error: "phone inválido" }, 400);
          }
          const { data, error } = await sb
            .from("crm_contacts")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("phone_norm", phoneNorm)
            .maybeSingle();
          if (error) {
            console.error("contact-enrich find by phone error", error);
            return jsonResponse({ ok: false, error: error.message }, 500);
          }
          contactId = data?.id ?? null;
        }
        if (!contactId) {
          return jsonResponse({ ok: false, error: "contato não encontrado" }, 404);
        }

        // -------- Resolve nomes de categorias → IDs (criando as inexistentes) --------
        const incomingNames: string[] = [];
        if (Array.isArray(category_names)) incomingNames.push(...category_names);
        if (category_name) incomingNames.push(category_name);

        // Preserva a ordem original (importante: índice 0 vira category_id principal)
        const seen = new Set<string>();
        const orderedNames: string[] = [];
        for (const n of incomingNames) {
          const t = n.trim();
          if (!t) continue;
          const k = t.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          orderedNames.push(t);
        }

        const orderedIds: string[] = [];
        const createdCategories: string[] = [];

        if (orderedNames.length > 0) {
          const { data: existing, error: catErr } = await sb
            .from("crm_categories")
            .select("id, name")
            .eq("user_id", ownerUserId);
          if (catErr) {
            console.error("contact-enrich load categories", catErr);
            return jsonResponse({ ok: false, error: catErr.message }, 500);
          }
          const byName = new Map<string, string>(
            (existing ?? []).map((c: any) => [String(c.name).trim().toLowerCase(), String(c.id)]),
          );

          for (const name of orderedNames) {
            const key = name.toLowerCase();
            let id = byName.get(key);
            if (!id) {
              const { data: created, error: createErr } = await sb
                .from("crm_categories")
                .insert({
                  user_id: ownerUserId,
                  name,
                  color: "#94a3b8",
                  status: "pending",
                })
                .select("id")
                .single();
              if (createErr) {
                console.error("contact-enrich create category", name, createErr);
                return jsonResponse({ ok: false, error: createErr.message }, 500);
              }
              id = String(created.id);
              byName.set(key, id);
              createdCategories.push(name);
            }
            orderedIds.push(id);
          }
        }

        // -------- Patch em campos simples --------
        const patch: Record<string, unknown> = {
          last_ai_sync: new Date().toISOString(),
        };
        if (name) patch.name = name;
        if (summary !== undefined) patch.ai_persona_summary = summary;
        if (persona_ia) patch.ai_persona_label = persona_ia;
        if (urgency) patch.urgency_level = urgency;

        const { error: upErr } = await sb
          .from("crm_contacts")
          .update(patch)
          .eq("id", contactId)
          .eq("user_id", ownerUserId);
        if (upErr) {
          console.error("contact-enrich update error", upErr);
          return jsonResponse({ ok: false, error: upErr.message }, 500);
        }

        // -------- Aplica categorias (merge ou replace) --------
        let categoriesAdded = 0;
        let categoriesRemoved = 0;
        let finalCategoryIds: string[] = [];

        if (orderedIds.length > 0) {
          const { data: current, error: currentErr } = await sb
            .from("crm_contact_categories")
            .select("category_id")
            .eq("contact_id", contactId);
          if (currentErr) {
            console.error("contact-enrich read bridge", currentErr);
            return jsonResponse({ ok: false, error: currentErr.message }, 500);
          }
          const currentIds = new Set<string>(
            (current ?? []).map((r: any) => String(r.category_id)),
          );

          let targetIds: string[];
          if (mode === "replace") {
            targetIds = [...orderedIds];
          } else {
            const merged: string[] = [];
            const seenIds = new Set<string>();
            // ordem: novas primeiro (preserva índice 0), depois antigas
            for (const id of [...orderedIds, ...currentIds]) {
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              merged.push(id);
            }
            targetIds = merged;
          }

          const targetSet = new Set(targetIds);
          const toInsert = targetIds.filter((id) => !currentIds.has(id));
          const toDelete =
            mode === "replace"
              ? [...currentIds].filter((id) => !targetSet.has(id))
              : [];

          if (toInsert.length) {
            const rows = toInsert.map((cid) => ({
              contact_id: contactId,
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
              .eq("contact_id", contactId)
              .in("category_id", toDelete);
            if (delErr) {
              console.error("contact-enrich delete categories", delErr);
              return jsonResponse({ ok: false, error: delErr.message }, 500);
            }
            categoriesRemoved = toDelete.length;
          }
          finalCategoryIds = targetIds;

          // Espelha a 1ª categoria do array em crm_contacts.category_id
          const primary = orderedIds[0] ?? null;
          if (primary) {
            const { error: mirrorErr } = await sb
              .from("crm_contacts")
              .update({ category_id: primary })
              .eq("id", contactId)
              .eq("user_id", ownerUserId);
            if (mirrorErr) {
              console.warn("contact-enrich mirror category_id", mirrorErr);
            }
          }
        }

        const responsePayload = {
          ok: true,
          contact_id: contactId,
          mode,
          updated: {
            name: !!name,
            ai_persona_summary: summary !== undefined,
            ai_persona_label: !!persona_ia,
            urgency_level: !!urgency,
            categories_added: categoriesAdded,
            categories_removed: categoriesRemoved,
            final_category_ids: finalCategoryIds,
            created_categories: createdCategories,
          },
        };

        // Fecha log de enriquecimento. Se o n8n perder o log_id no caminho,
        // usa o último disparo pendente desse contato como fallback.
        let targetLogId = log_id ?? null;
        if (!targetLogId) {
          const { data: latestLog, error: findLogErr } = await sb
            .from("crm_ai_enrichment_logs")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("contact_id", contactId)
            .eq("status", "dispatched")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (findLogErr) {
            console.warn("contact-enrich find pending log error", findLogErr);
          }
          targetLogId = latestLog?.id ?? null;
        }

        if (targetLogId) {
          const { error: logErr } = await sb
            .from("crm_ai_enrichment_logs")
            .update({
              status: "success",
              response_payload: responsePayload,
              completed_at: new Date().toISOString(),
            })
            .eq("id", targetLogId)
            .eq("user_id", ownerUserId);
          if (logErr) {
            console.warn("contact-enrich update log error", logErr);
          }
        }

        return jsonResponse(responsePayload);
      },
    },
  },
});

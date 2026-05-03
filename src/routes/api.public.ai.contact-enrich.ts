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
        let contactIsIgnored = false;
        let contactPhoneNorm: string | null = null;
        if (contact_id) {
          const { data, error } = await sb
            .from("crm_contacts")
            .select("id,is_ignored,phone_norm")
            .eq("id", contact_id)
            .eq("user_id", ownerUserId)
            .maybeSingle();
          if (error) {
            console.error("contact-enrich find by id error", error);
            return jsonResponse({ ok: false, error: error.message }, 500);
          }
          contactId = data?.id ?? null;
          contactIsIgnored = Boolean(data?.is_ignored);
          contactPhoneNorm = data?.phone_norm ?? null;
        } else if (phone) {
          const phoneNorm = normalizePhone(phone);
          if (!phoneNorm) {
            return jsonResponse({ ok: false, error: "phone inválido" }, 400);
          }
          contactPhoneNorm = phoneNorm;
          const { data, error } = await sb
            .from("crm_contacts")
            .select("id,is_ignored")
            .eq("user_id", ownerUserId)
            .eq("phone_norm", phoneNorm)
            .maybeSingle();
          if (error) {
            console.error("contact-enrich find by phone error", error);
            return jsonResponse({ ok: false, error: error.message }, 500);
          }
          contactId = data?.id ?? null;
          contactIsIgnored = Boolean(data?.is_ignored);
        }
        if (!contactId) {
          return jsonResponse({ ok: false, error: "contato não encontrado" }, 404);
        }

        // -------- Blacklist guard (cinto-e-suspensório) --------
        // 1) flag derivada no contato
        // 2) revalida na tabela fonte da verdade caso o trigger esteja atrasado
        if (!contactIsIgnored && contactPhoneNorm) {
          const { data: blk } = await sb
            .from("crm_ignored_phones")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("phone_norm", contactPhoneNorm)
            .maybeSingle();
          if (blk?.id) contactIsIgnored = true;
        }
        if (contactIsIgnored) {
          return jsonResponse(
            {
              ok: false,
              error: "ignored_contact",
              message: "Contato está na blacklist do usuário e não será enriquecido.",
              contact_id: contactId,
            },
            409,
          );
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

        // -------- Transcrição do cliente (usada por keyword-match e anti-alucinação) --------
        const norm = (s: string) =>
          s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const { data: msgsRaw } = await sb
          .from("crm_messages")
          .select("body, from_me")
          .eq("user_id", ownerUserId)
          .eq("contact_id", contactId)
          .order("at", { ascending: false })
          .limit(80);
        const rawTranscript = norm(
          (msgsRaw ?? [])
            .filter((m: any) => !m.from_me)
            .map((m: any) => String(m.body ?? ""))
            .join(" \n "),
        );
        const transcript = rawTranscript
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ");

        // -------- Auto-classificação por palavras-chave (PRIORIDADE) --------
        // Para cada categoria do tenant que tem `keywords`, se qualquer
        // keyword aparecer na transcrição do cliente, a categoria é
        // PREPENDADA em orderedNames. Isso garante que ela:
        //  1) entra mesmo se a IA não sugeriu;
        //  2) tem prioridade sobre o que a IA mandou;
        //  3) escapa da trava anti-alucinação (já está antes, e o filtro
        //     abaixo tem GENERIC + lookup por nome real existente).
        const keywordMatched: string[] = [];
        try {
          const { data: catsKw } = await sb
            .from("crm_categories")
            .select("name, keywords")
            .eq("user_id", ownerUserId);
          const matched: string[] = [];
          for (const row of catsKw ?? []) {
            const kws: string[] = Array.isArray((row as any).keywords)
              ? ((row as any).keywords as any[]).map((x) => String(x ?? "")).filter(Boolean)
              : [];
            if (kws.length === 0) continue;
            const hit = kws.some((kw) => {
              const n = norm(kw).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
              if (!n) return false;
              if (n.includes(" ")) {
                return transcript.includes(n);
              }
              const re = new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`);
              return re.test(transcript);
            });
            if (hit) matched.push(String((row as any).name));
          }
          // Prepend (ordem reversa para preservar a ordem natural das categorias)
          for (let i = matched.length - 1; i >= 0; i--) {
            const nm = matched[i];
            const k = nm.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            orderedNames.unshift(nm);
            keywordMatched.push(nm);
          }
        } catch (kwErr) {
          console.warn("[contact-enrich] keyword match failed", kwErr);
        }


        // -------- Trava anti-alucinação de marcas --------
        // A IA às vezes inventa marcas que o cliente NUNCA citou (ex: cliente
        // pediu "icsee" e veio "Cliente Mibo Smart" + "Cliente Multi Giga Admin").
        // Para cada categoria do formato "Cliente <Marca>", verificamos se a
        // marca aparece literalmente no histórico de mensagens do contato.
        // Categorias genéricas (Câmeras, Alarme, etc.) passam sem checagem.
        const droppedHallucinations: string[] = [];
        if (orderedNames.length > 0) {
          const { data: msgsRaw } = await sb
            .from("crm_messages")
            .select("body, from_me")
            .eq("user_id", ownerUserId)
            .eq("contact_id", contactId)
            .order("at", { ascending: false })
            .limit(80);
          const norm = (s: string) =>
            s
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
          // Concatena só o que o CLIENTE escreveu (from_me=false). O que o
          // atendente disse não conta — a marca pode ter sido sugerida pelo bot.
          // IMPORTANTE: normalizamos pontuação (hífens, barras, pontos…) para
          // espaço, igual ao que fazemos com a marca abaixo. Sem isso, marcas
          // tipo "WD-MOB" / "Wi-Fi" nunca casam, porque o cliente escreve
          // "wd-mob" no chat e a marca normalizada vira "wd mob".
          const rawTranscript = norm(
            (msgsRaw ?? [])
              .filter((m: any) => !m.from_me)
              .map((m: any) => String(m.body ?? ""))
              .join(" \n "),
          );
          const transcript = rawTranscript
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ");

          // Categorias genéricas que SEMPRE podem passar (não são marca específica).
          // Aceita com OU sem prefixo "cliente " (legado + novo formato puro).
          const GENERIC = new Set(
            [
              "cameras",
              "cameras wi-fi",
              "cameras wifi",
              "alarme",
              "alarmes",
              "cerca eletrica",
              "cftv",
              "geral",
              "automacao",
              "controle de acesso",
              "interfone",
              "portao",
              "suporte",
            ],
          );

          const filtered: string[] = [];
          for (const original of orderedNames) {
            const n = norm(original);
            // Remove prefixo "cliente " se existir (compat com formato antigo)
            const stripped = n.startsWith("cliente ")
              ? n.slice("cliente ".length).trim()
              : n;
            if (GENERIC.has(stripped)) {
              filtered.push(original);
              continue;
            }
            // "brand" = nome da categoria sem o prefixo legado
            const brand = stripped;
            if (!brand) {
              filtered.push(original);
              continue;
            }
            // Regra reforçada (anti-cardápio do n8n):
            // - Marca multi-token (ex: "multi giga admin", "mibo smart"): exige
            //   a FRASE COMPLETA da marca como substring na transcrição. Se não
            //   estiver inteira, exige pelo menos UM bigrama adjacente
            //   (ex: "mibo smart" OU "multi giga"). Tokens soltos NÃO bastam,
            //   porque "multi", "smart", "admin" são palavras genéricas que
            //   aparecem em qualquer conversa.
            // - Marca single-token (ex: "hikvision", "icsee"): exige a palavra
            //   inteira (word boundary), não substring solta.
            const cleanBrand = brand.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
            const tokens = cleanBrand
              .split(" ")
              .map((t) => t.replace(/[^a-z0-9]/g, ""))
              .filter(Boolean);

            const matchWord = (word: string) => {
              if (!word) return false;
              const re = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i");
              return re.test(transcript);
            };

            let ok = false;
            if (tokens.length <= 1) {
              ok = matchWord(tokens[0] ?? brand);
            } else {
              // 1) frase completa
              if (transcript.includes(cleanBrand)) {
                ok = true;
              } else {
                // 2) algum bigrama adjacente (token[i] + " " + token[i+1])
                for (let i = 0; i < tokens.length - 1; i++) {
                  const bigram = `${tokens[i]} ${tokens[i + 1]}`;
                  if (transcript.includes(bigram)) { ok = true; break; }
                }
              }
            }

            if (ok) filtered.push(original);
            else droppedHallucinations.push(original);
          }

          if (droppedHallucinations.length > 0) {
            console.warn(
              `[contact-enrich] Dropped hallucinated categories for ${contactId}:`,
              droppedHallucinations,
              "transcript_len=",
              transcript.length,
            );
          }
          orderedNames.length = 0;
          orderedNames.push(...filtered);
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
          // Chave normalizada: lower + trim + colapso de espaços (igual ao
          // índice único do banco). Garante que "Hikvision", "hikvision" e
          // " Hikvision " sejam tratadas como a MESMA categoria.
          const normKey = (s: string) =>
            s.trim().toLowerCase().replace(/\s+/g, " ");
          const byName = new Map<string, string>(
            (existing ?? []).map((c: any) => [normKey(String(c.name)), String(c.id)]),
          );

          for (const name of orderedNames) {
            const cleanName = name.trim().replace(/\s+/g, " ");
            const key = normKey(cleanName);
            let id = byName.get(key);
            if (!id) {
              const { data: created, error: createErr } = await sb
                .from("crm_categories")
                .insert({
                  user_id: ownerUserId,
                  name: cleanName,
                  color: "#94a3b8",
                  status: "pending",
                })
                .select("id")
                .single();
              if (createErr) {
                // Corrida com índice único: outra requisição criou no meio.
                // Recarrega e tenta resolver pelo nome.
                if ((createErr as any).code === "23505") {
                  const { data: again } = await sb
                    .from("crm_categories")
                    .select("id, name")
                    .eq("user_id", ownerUserId)
                    .ilike("name", cleanName)
                    .maybeSingle();
                  if (again?.id) {
                    id = String(again.id);
                    byName.set(key, id);
                    orderedIds.push(id);
                    continue;
                  }
                }
                console.error("contact-enrich create category", cleanName, createErr);
                return jsonResponse({ ok: false, error: createErr.message }, 500);
              }
              id = String(created.id);
              byName.set(key, id);
              createdCategories.push(cleanName);
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
            dropped_hallucinations: droppedHallucinations,
          },
        };

        // Fecha log de enriquecimento. Se o log_id não bater com nenhuma linha,
        // usa o último disparo pendente desse contato como fallback.
        const completedAt = new Date().toISOString();
        let targetLogId = log_id ?? null;
        let logUpdated = false;

        if (targetLogId) {
          const { data: updatedRows, error: logErr } = await sb
            .from("crm_ai_enrichment_logs")
            .update({
              status: "success",
              response_payload: responsePayload,
              completed_at: completedAt,
            })
            .eq("id", targetLogId)
            .eq("user_id", ownerUserId)
            .select("id");
          if (logErr) {
            console.warn("contact-enrich update log error", logErr);
          } else {
            logUpdated = (updatedRows?.length ?? 0) > 0;
          }
        }

        if (!logUpdated) {
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
          targetLogId = latestLog?.id ?? targetLogId;

          if (latestLog?.id) {
            const { data: fallbackRows, error: fallbackErr } = await sb
              .from("crm_ai_enrichment_logs")
              .update({
                status: "success",
                response_payload: responsePayload,
                completed_at: completedAt,
              })
              .eq("id", latestLog.id)
              .eq("user_id", ownerUserId)
              .select("id");
            if (fallbackErr) {
              console.warn("contact-enrich fallback update log error", fallbackErr);
            } else {
              logUpdated = (fallbackRows?.length ?? 0) > 0;
            }
          }
        }

        return jsonResponse({
          ...responsePayload,
          enrichment_log: { updated: logUpdated, log_id: targetLogId },
        });
      },
    },
  },
});

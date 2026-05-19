// POST /api/public/evolution/bulk-tick
// Cron runner: chamado pelo n8n a cada 1 min. Procura disparos com
// status='scheduled' e scheduled_at <= now() e inicia o envio para cada um.
// Auth: x-api-key (mesma N8N_API_KEY usada nos outros endpoints públicos).
//
// Resposta: { ok, picked: [{ bulkId, userId, contacts }], skipped: [...] }
//
// Idempotente: marca status='in_progress' antes de chamar runBulkDispatch
// (que também o marca), então uma segunda chamada simultânea não re-pega.

import { createFileRoute } from "@tanstack/react-router";
import {
  getSupabaseAdmin,
  checkApiKey,
  PUBLIC_CORS,
  jsonResponse,
} from "@/integrations/supabase/server";
import { runBulkDispatch, getEvolutionEnv } from "@/server/bulk-dispatch.server";

export const Route = createFileRoute("/api/public/evolution/bulk-tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
        if (!checkApiKey(request)) return jsonResponse({ error: "Unauthorized" }, 401);

        const { apiUrl, apiKey } = getEvolutionEnv();
        if (!apiUrl || !apiKey) {
          return jsonResponse({ ok: false, error: "EVOLUTION_API_URL/KEY ausentes" }, 500);
        }

        const sb = getSupabaseAdmin();
        const nowIso = new Date().toISOString();
        const orphanCutoffIso = new Date(Date.now() - 90_000).toISOString();

        // 1) Agendados que chegaram a hora.
        const { data: dueScheduled, error: errSched } = await sb
          .from("crm_bulk_sends")
          .select(
            "id, user_id, message, interval_seconds, contact_ids, control, media_type, media_base64, media_mime, media_filename, media_caption, status, claimed_at",
          )
          .eq("status", "scheduled")
          .lte("scheduled_at", nowIso)
          .limit(20);
        if (errSched) return jsonResponse({ ok: false, error: errSched.message }, 500);

        // 2) Em andamento mas órfãos (Worker morreu / batch-per-tick precisa
        //    continuar). claimed_at null OU < now()-90s => repesca.
        const { data: dueOrphans, error: errOrph } = await sb
          .from("crm_bulk_sends")
          .select(
            "id, user_id, message, interval_seconds, contact_ids, control, media_type, media_base64, media_mime, media_filename, media_caption, status, claimed_at",
          )
          .eq("status", "in_progress")
          .or(`claimed_at.is.null,claimed_at.lt.${orphanCutoffIso}`)
          .limit(20);
        if (errOrph) return jsonResponse({ ok: false, error: errOrph.message }, 500);

        const due = [...(dueScheduled ?? []), ...(dueOrphans ?? [])];

        const picked: any[] = [];
        const skipped: any[] = [];
        const picked_promises: Promise<any>[] = [];

        for (const row of due) {
          if (row.control === "cancelled") {
            await sb
              .from("crm_bulk_sends")
              .update({ status: "cancelled", claimed_at: null })
              .eq("id", row.id);
            skipped.push({ bulkId: row.id, reason: "cancelled" });
            continue;
          }
          const contactIds = (row.contact_ids ?? []) as string[];
          if (!Array.isArray(contactIds) || contactIds.length === 0) {
            await sb
              .from("crm_bulk_sends")
              .update({ status: "error", claimed_at: null })
              .eq("id", row.id);
            skipped.push({ bulkId: row.id, reason: "no contact_ids" });
            continue;
          }

          // Reserva atômica: só pega se status ainda for o esperado E
          // (para órfãos) o claimed_at não tiver mudado nesse meio tempo.
          const claimUpdate: Record<string, any> = {
            status: "in_progress",
            claimed_at: new Date().toISOString(),
          };
          let claimQuery = sb
            .from("crm_bulk_sends")
            .update(claimUpdate)
            .eq("id", row.id)
            .eq("status", row.status);
          if (row.status === "in_progress") {
            // só repesca se ainda for órfão (evita roubar de outro tick ativo)
            if (row.claimed_at) {
              claimQuery = claimQuery.lt("claimed_at", orphanCutoffIso);
            } else {
              claimQuery = claimQuery.is("claimed_at", null);
            }
          }
          const { data: claimed, error: claimErr } = await claimQuery
            .select("id")
            .maybeSingle();
          if (claimErr || !claimed) {
            skipped.push({ bulkId: row.id, reason: "race" });
            continue;
          }

          const media = row.media_type
            ? {
                type: row.media_type as "image" | "document" | "video" | "audio",
                base64: row.media_base64 as string,
                mime: row.media_mime,
                filename: row.media_filename,
                caption: row.media_caption,
              }
            : null;

          const promise = runBulkDispatch({
            userId: row.user_id,
            bulkId: row.id,
            contactIds,
            message: row.message,
            intervalSeconds: row.interval_seconds,
            media,
            apiUrl,
            apiKey,
          }).catch(async (err) => {
            console.error("[bulk-tick] dispatch failed", row.id, err);
            await sb
              .from("crm_bulk_sends")
              .update({ status: "error", claimed_at: null })
              .eq("id", row.id);
          });

          const ctx: any = (globalThis as any).__cloudflare_context__ ?? null;
          if (ctx?.waitUntil) ctx.waitUntil(promise);
          else picked_promises.push(promise);

          picked.push({ bulkId: row.id, userId: row.user_id, contacts: contactIds.length });
        }

        // Sem waitUntil disponível no runtime: aguarda os dispatches dentro do
        // próprio request. Sleeps/fetches não consomem CPU no Worker, então é
        // seguro mesmo com vários contatos (limite real é wall-clock do request).
        if (picked_promises.length) await Promise.allSettled(picked_promises);

        return jsonResponse({ ok: true, picked, skipped });
      },
    },
  },
});

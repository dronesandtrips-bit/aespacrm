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

        const { data: due, error } = await sb
          .from("crm_bulk_sends")
          .select(
            "id, user_id, message, interval_seconds, contact_ids, control, media_type, media_base64, media_mime, media_filename, media_caption",
          )
          .eq("status", "scheduled")
          .lte("scheduled_at", nowIso)
          .limit(20);
        if (error) return jsonResponse({ ok: false, error: error.message }, 500);

        const picked: any[] = [];
        const skipped: any[] = [];
        const picked_promises: Promise<any>[] = [];

        for (const row of due ?? []) {
          if (row.control === "cancelled") {
            await sb.from("crm_bulk_sends").update({ status: "cancelled" }).eq("id", row.id);
            skipped.push({ bulkId: row.id, reason: "cancelled" });
            continue;
          }
          const contactIds = (row.contact_ids ?? []) as string[];
          if (!Array.isArray(contactIds) || contactIds.length === 0) {
            await sb.from("crm_bulk_sends").update({ status: "error" }).eq("id", row.id);
            skipped.push({ bulkId: row.id, reason: "no contact_ids" });
            continue;
          }

          // Reserva de forma atômica: só pega se ainda estiver 'scheduled'.
          const { data: claimed, error: claimErr } = await sb
            .from("crm_bulk_sends")
            .update({ status: "in_progress" })
            .eq("id", row.id)
            .eq("status", "scheduled")
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
            await sb.from("crm_bulk_sends").update({ status: "error" }).eq("id", row.id);
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

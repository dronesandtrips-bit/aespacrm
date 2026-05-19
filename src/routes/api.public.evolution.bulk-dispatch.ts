// POST /api/public/evolution/bulk-dispatch
// Worker de disparo em massa IMEDIATO (texto + variáveis + mídia).
// Para disparos AGENDADOS, o cron /api/public/evolution/bulk-tick é quem
// inicia a execução quando scheduled_at chega — esta rota apenas confirma
// o registro (não bloqueia request com sleep até o horário, pois
// Cloudflare Workers encerra a execução após enviar a resposta).
//
// Auth: Authorization: Bearer <user-jwt>
// Body: { bulkId, contactIds: string[], message: string, intervalSeconds: number,
//         scheduledAt?: ISO, media?: { type, base64, mime?, filename?, caption? } }

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";
import { runBulkDispatch, getEvolutionEnv } from "@/server/bulk-dispatch.server";

const MediaSchema = z.object({
  type: z.enum(["image", "document", "video", "audio"]),
  base64: z.string().min(1).max(20_000_000),
  mime: z.string().trim().min(3).max(100).optional().nullable(),
  filename: z.string().trim().min(1).max(255).optional().nullable(),
  caption: z.string().trim().max(1024).optional().nullable(),
});

const Schema = z.object({
  bulkId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).min(1).max(5000),
  message: z.string().trim().min(1).max(4096),
  intervalSeconds: z.number().int().min(1).max(120),
  scheduledAt: z.string().datetime().optional().nullable(),
  media: MediaSchema.optional().nullable(),
});

export const Route = createFileRoute("/api/public/evolution/bulk-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { apiUrl, apiKey } = getEvolutionEnv();
          const rawSupa = process.env.AESPACRM_SUPA_URL?.trim() ?? "";
          const supaUrl = rawSupa
            ? (/^https?:\/\//i.test(rawSupa) ? rawSupa : `https://${rawSupa}`).replace(/\/+$/, "")
            : "";
          const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
          if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
            return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
          }

          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!token) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

          const userClient = createClient(supaUrl, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
          if (authErr || !userRes?.user) {
            return jsonResponse({ ok: false, error: "invalid token" }, 401);
          }
          const userId = userRes.user.id;

          let parsed;
          try {
            parsed = Schema.parse(await request.json());
          } catch (e: any) {
            return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
          }

          const sb = getSupabaseAdmin();
          const { data: bulk } = await sb
            .from("crm_bulk_sends")
            .select("id, status")
            .eq("id", parsed.bulkId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!bulk) return jsonResponse({ ok: false, error: "disparo não encontrado" }, 404);
          if (!["in_progress", "pending", "scheduled"].includes(bulk.status)) {
            return jsonResponse(
              { ok: false, error: `disparo já está em estado '${bulk.status}'` },
              409,
            );
          }

          // Agendado: NÃO inicia agora — o cron bulk-tick pega no horário.
          if (parsed.scheduledAt) {
            return jsonResponse({
              ok: true,
              bulkId: parsed.bulkId,
              scheduled: true,
              scheduledAt: parsed.scheduledAt,
            });
          }

          const promise = runBulkDispatch({
            userId,
            bulkId: parsed.bulkId,
            contactIds: parsed.contactIds,
            message: parsed.message,
            intervalSeconds: parsed.intervalSeconds,
            media: parsed.media ?? null,
            apiUrl,
            apiKey,
          }).catch(async (err) => {
            console.error("[bulk] dispatch failed", err);
            await sb
              .from("crm_bulk_sends")
              .update({ status: "error", claimed_at: null })
              .eq("id", parsed.bulkId);
          });

          const ctx: any = (globalThis as any).__cloudflare_context__ ?? null;
          if (ctx?.waitUntil) {
            ctx.waitUntil(promise);
          } else {
            await promise;
          }

          return jsonResponse({
            ok: true,
            bulkId: parsed.bulkId,
            contacts: parsed.contactIds.length,
            intervalSeconds: parsed.intervalSeconds,
            scheduled: false,
          });
        } catch (err: any) {
          console.error("[bulk-dispatch] unhandled", err);
          return jsonResponse({ ok: false, error: err?.message ?? String(err) }, 500);
        }
      },
    },
  },
});

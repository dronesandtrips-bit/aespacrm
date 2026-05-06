// POST /api/public/evolution/bulk-dispatch
// Worker de disparo em massa. Suporta: texto + variáveis ({nome},{primeiro_nome},
// {empresa},{categoria}), envio de mídia opcional, agendamento (espera até
// scheduled_at) e controle pausar/cancelar via coluna `control`.
//
// Auth: Authorization: Bearer <user-jwt>
// Body: { bulkId, contactIds: string[], message: string, intervalSeconds: number,
//         scheduledAt?: ISO, media?: { type, base64, mime?, filename?, caption? } }
//
// Para cada contato: aplica variáveis -> envia (text|media) -> grava crm_messages
// -> incrementa sent_count -> consulta `control` -> aguarda intervalo.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function applyVars(
  template: string,
  ctx: { name: string; firstName: string; company: string; category: string },
) {
  return template
    .replaceAll("{nome}", ctx.name)
    .replaceAll("{primeiro_nome}", ctx.firstName)
    .replaceAll("{empresa}", ctx.company)
    .replaceAll("{categoria}", ctx.category);
}

async function runDispatch(opts: {
  userId: string;
  bulkId: string;
  contactIds: string[];
  message: string;
  intervalSeconds: number;
  scheduledAt?: string | null;
  media?: z.infer<typeof MediaSchema> | null;
  apiUrl: string;
  apiKey: string;
}) {
  const sb = getSupabaseAdmin();
  const {
    userId, bulkId, contactIds, message, intervalSeconds, scheduledAt, media, apiUrl, apiKey,
  } = opts;

  // 1. Aguarda agendamento (poll a cada 30s, cancelável via control).
  if (scheduledAt) {
    const target = new Date(scheduledAt).getTime();
    while (Date.now() < target) {
      const { data: row } = await sb
        .from("crm_bulk_sends")
        .select("control")
        .eq("id", bulkId)
        .maybeSingle();
      if (row?.control === "cancelled") {
        await sb.from("crm_bulk_sends").update({ status: "cancelled" }).eq("id", bulkId);
        return;
      }
      const wait = Math.min(30_000, Math.max(1_000, target - Date.now()));
      await sleep(wait);
    }
    await sb.from("crm_bulk_sends").update({ status: "in_progress" }).eq("id", bulkId);
  }

  // 2. Busca contatos (com categorias para {categoria}).
  const { data: contacts } = await sb
    .from("crm_contacts")
    .select("id, name, phone_norm, notes, category_id, crm_categories(name)")
    .eq("user_id", userId)
    .eq("is_group", false)
    .in("id", contactIds);

  const valid = (contacts ?? []).filter((c: any) => c.phone_norm);
  let sent = 0;
  let failed = 0;
  let cancelled = false;

  for (let i = 0; i < valid.length; i++) {
    // Checagem de controle a cada iteração.
    const { data: state } = await sb
      .from("crm_bulk_sends")
      .select("control")
      .eq("id", bulkId)
      .maybeSingle();
    if (state?.control === "cancelled") {
      cancelled = true;
      break;
    }
    // Pause: aguarda em loop até control voltar a 'run' ou virar 'cancelled'.
    if (state?.control === "paused") {
      await sb.from("crm_bulk_sends").update({ status: "paused" }).eq("id", bulkId);
      while (true) {
        await sleep(5_000);
        const { data: s2 } = await sb
          .from("crm_bulk_sends")
          .select("control")
          .eq("id", bulkId)
          .maybeSingle();
        if (s2?.control === "cancelled") { cancelled = true; break; }
        if (s2?.control === "run") {
          await sb.from("crm_bulk_sends").update({ status: "in_progress" }).eq("id", bulkId);
          break;
        }
      }
      if (cancelled) break;
    }

    const c: any = valid[i];
    const fullName = String(c.name ?? "");
    const firstName = fullName.split(" ")[0] ?? fullName;
    const company = String(c.notes ?? "").trim() || fullName;
    const category = (c.crm_categories?.name as string) ?? "";
    const text = applyVars(message, { name: fullName, firstName, company, category });

    try {
      let res: Response;
      if (media) {
        const caption = media.caption
          ? applyVars(media.caption, { name: fullName, firstName, company, category })
          : (text || undefined);
        res = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            number: c.phone_norm,
            mediatype: media.type,
            media: media.base64,
            mimetype: media.mime ?? undefined,
            fileName: media.filename ?? undefined,
            caption,
          }),
        });
      } else {
        res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ number: c.phone_norm, text }),
        });
      }
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        sent++;
        await sb.from("crm_messages").upsert(
          {
            user_id: userId,
            contact_id: c.id,
            body: media ? (media.caption ? text : `[${media.type}]`) : text,
            from_me: true,
            type: media ? media.type : "text",
            message_id: data?.key?.id ?? null,
            remote_jid: data?.key?.remoteJid ?? `${c.phone_norm}@s.whatsapp.net`,
            media_mime: media?.mime ?? null,
            media_caption: media ? text : null,
            status: "sent",
            raw: { bulk_id: bulkId, ...data },
          },
          { onConflict: "user_id,message_id", ignoreDuplicates: false },
        );
      } else {
        failed++;
        await sb.from("crm_messages").insert({
          user_id: userId,
          contact_id: c.id,
          body: text,
          from_me: true,
          type: media ? media.type : "text",
          status: "failed",
          raw: { bulk_id: bulkId, error: data },
        });
      }
    } catch (err: any) {
      failed++;
      console.error("[bulk] send error", err);
    }

    await sb
      .from("crm_bulk_sends")
      .update({ sent_count: sent + failed })
      .eq("id", bulkId)
      .eq("user_id", userId);

    if (i < valid.length - 1) await sleep(intervalSeconds * 1000);
  }

  const finalStatus = cancelled
    ? "cancelled"
    : valid.length === 0
    ? "error"
    : failed === valid.length
    ? "error"
    : "completed";

  await sb
    .from("crm_bulk_sends")
    .update({ status: finalStatus, sent_count: sent + failed })
    .eq("id", bulkId)
    .eq("user_id", userId);
}

export const Route = createFileRoute("/api/public/evolution/bulk-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
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

          const promise = runDispatch({
            userId,
            bulkId: parsed.bulkId,
            contactIds: parsed.contactIds,
            message: parsed.message,
            intervalSeconds: parsed.intervalSeconds,
            scheduledAt: parsed.scheduledAt ?? null,
            media: parsed.media ?? null,
            apiUrl,
            apiKey,
          }).catch(async (err) => {
            console.error("[bulk] dispatch failed", err);
            await sb
              .from("crm_bulk_sends")
              .update({ status: "error" })
              .eq("id", parsed.bulkId);
          });

          const ctx: any = (globalThis as any).__cloudflare_context__ ?? null;
          if (ctx?.waitUntil) {
            ctx.waitUntil(promise);
          } else if (parsed.scheduledAt) {
            // Agendado: não bloquear request.
            void promise;
          } else {
            await promise;
          }

          return jsonResponse({
            ok: true,
            bulkId: parsed.bulkId,
            contacts: parsed.contactIds.length,
            intervalSeconds: parsed.intervalSeconds,
            scheduled: !!parsed.scheduledAt,
          });
        } catch (err: any) {
          console.error("[bulk-dispatch] unhandled", err);
          return jsonResponse({ ok: false, error: err?.message ?? String(err) }, 500);
        }
      },
    },
  },
});

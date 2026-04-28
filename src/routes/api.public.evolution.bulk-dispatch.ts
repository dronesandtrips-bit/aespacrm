// POST /api/public/evolution/bulk-dispatch
// Worker de disparo em massa. Recebe um bulkId já criado em crm_bulk_sends
// (status=in_progress) e a lista de contactIds. Roda em background no Worker
// (ctx.waitUntil) — assim a request retorna imediatamente.
//
// Auth: Authorization: Bearer <user-jwt>
// Body: { bulkId, contactIds: string[], message: string, intervalSeconds: number }
//
// Para cada contato:
//   - substitui {nome} pelo primeiro nome
//   - chama Evolution sendText
//   - grava crm_messages (status sent|failed)
//   - incrementa sent_count
//   - aguarda intervalSeconds antes do próximo
// Ao final: status=completed (ou error se TODOS falharem).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

const Schema = z.object({
  bulkId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).min(1).max(5000),
  message: z.string().trim().min(1).max(4096),
  intervalSeconds: z.number().int().min(1).max(120),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDispatch(opts: {
  userId: string;
  bulkId: string;
  contactIds: string[];
  message: string;
  intervalSeconds: number;
  apiUrl: string;
  apiKey: string;
}) {
  const sb = getSupabaseAdmin();
  const { userId, bulkId, contactIds, message, intervalSeconds, apiUrl, apiKey } = opts;

  // Busca contatos válidos (filtra por user_id)
  const { data: contacts } = await sb
    .from("crm_contacts")
    .select("id, name, phone_norm")
    .eq("user_id", userId)
    .in("id", contactIds);

  const validContacts = (contacts ?? []).filter((c: any) => c.phone_norm);
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < validContacts.length; i++) {
    const c: any = validContacts[i];
    const firstName = String(c.name).split(" ")[0] ?? c.name;
    const text = message.replaceAll("{nome}", firstName);

    try {
      const res = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number: c.phone_norm, text }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        sent++;
        await sb.from("crm_messages").upsert(
          {
            user_id: userId,
            contact_id: c.id,
            body: text,
            from_me: true,
            type: "text",
            message_id: data?.key?.id ?? null,
            remote_jid: data?.key?.remoteJid ?? `${c.phone_norm}@s.whatsapp.net`,
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
          type: "text",
          status: "failed",
          raw: { bulk_id: bulkId, error: data },
        });
      }
    } catch (err: any) {
      failed++;
      console.error("[bulk] send error", err);
    }

    // Atualiza progresso a cada envio
    await sb
      .from("crm_bulk_sends")
      .update({ sent_count: sent + failed })
      .eq("id", bulkId)
      .eq("user_id", userId);

    // Aguarda intervalo (exceto no último)
    if (i < validContacts.length - 1) {
      await sleep(intervalSeconds * 1000);
    }
  }

  // Status final
  const finalStatus = validContacts.length === 0
    ? "error"
    : failed === validContacts.length
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
        const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const supaUrl = process.env.AESPACRM_SUPA_URL?.trim().replace(/\/+$/, "");
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

        // Verifica que o bulk pertence ao usuário
        const sb = getSupabaseAdmin();
        const { data: bulk } = await sb
          .from("crm_bulk_sends")
          .select("id, status")
          .eq("id", parsed.bulkId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!bulk) {
          return jsonResponse({ ok: false, error: "disparo não encontrado" }, 404);
        }
        if (bulk.status !== "in_progress" && bulk.status !== "pending") {
          return jsonResponse(
            { ok: false, error: `disparo já está em estado '${bulk.status}'` },
            409,
          );
        }

        // Roda em background — não bloqueia a resposta
        const promise = runDispatch({
          userId,
          bulkId: parsed.bulkId,
          contactIds: parsed.contactIds,
          message: parsed.message,
          intervalSeconds: parsed.intervalSeconds,
          apiUrl,
          apiKey,
        }).catch(async (err) => {
          console.error("[bulk] dispatch failed", err);
          await sb
            .from("crm_bulk_sends")
            .update({ status: "error" })
            .eq("id", parsed.bulkId);
        });

        // Cloudflare Workers: usa waitUntil se disponível
        const ctx: any = (globalThis as any).__cloudflare_context__ ?? null;
        if (ctx?.waitUntil) {
          ctx.waitUntil(promise);
        } else {
          // Fallback: deixa rodando (Node.js mantém o processo vivo)
          void promise;
        }

        return jsonResponse({
          ok: true,
          bulkId: parsed.bulkId,
          contacts: parsed.contactIds.length,
          intervalSeconds: parsed.intervalSeconds,
          message: "Disparo iniciado em background",
        });
      },
    },
  },
});

// POST /api/public/evolution/send-and-log
// Send do Inbox: chama Evolution API + grava em crm_messages atomicamente.
// Auth: Authorization: Bearer <user-jwt>  (do login do Supabase)
// Body: { contactId: "...", text: "..." }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

const Schema = z.object({
  contactId: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

export const Route = createFileRoute("/api/public/evolution/send-and-log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
        const apiUrl = process.env.EVOLUTION_API_URL ? normalizeUrl(process.env.EVOLUTION_API_URL) : "";
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const supaUrl = process.env.AESPACRM_SUPA_URL ? normalizeUrl(process.env.AESPACRM_SUPA_URL) : "";
        const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
        if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
          return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
        }

        // Valida usuário pelo JWT
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

        const userClient = createClient(supaUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          db: { schema: "aespacrm" },
          global: { headers: { Authorization: `Bearer ${token}` } },
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

        // Busca contato (RLS garante que é do usuário)
        const sbAdmin = getSupabaseAdmin();
        const { data: contact, error: contactErr } = await sbAdmin
          .from("crm_contacts")
          .select("id, phone_norm, name, is_group, wa_jid")
          .eq("id", parsed.contactId)
          .eq("user_id", userId)
          .maybeSingle();
        if (contactErr || !contact) {
          return jsonResponse({ ok: false, error: "contato não encontrado" }, 404);
        }

        // Para grupos, o "number" enviado à Evolution é o JID completo (@g.us).
        // Para 1:1, usamos o phone_norm.
        let sendNumber: string;
        if (contact.is_group) {
          if (!contact.wa_jid) {
            return jsonResponse({ ok: false, error: "grupo sem JID" }, 400);
          }
          sendNumber = contact.wa_jid;
        } else {
          if (!contact.phone_norm) {
            return jsonResponse({ ok: false, error: "contato sem telefone válido" }, 400);
          }
          sendNumber = contact.phone_norm;
        }

        // Envia via Evolution
        const evRes = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ number: sendNumber, text: parsed.text }),
        });
        const evText = await evRes.text();
        let evData: any = evText;
        try { evData = JSON.parse(evText); } catch {}

        if (!evRes.ok) {
          // Loga falha
          await sbAdmin.from("crm_messages").insert({
            user_id: userId,
            contact_id: contact.id,
            body: parsed.text,
            from_me: true,
            at: new Date().toISOString(),
            type: "text",
            status: "failed",
            raw: { error: evData },
          });
          return jsonResponse(
            { ok: false, status: evRes.status, error: evData },
            502,
          );
        }

        const messageId: string | null = evData?.key?.id ?? null;
        const remoteJid: string | null =
          evData?.key?.remoteJid ??
          (contact.is_group ? contact.wa_jid : `${contact.phone_norm}@s.whatsapp.net`);

        // Insert simples. O índice único de message_id é parcial (where message_id is not null)
        // e o Postgres não aceita esse índice em ON CONFLICT, então tratamos duplicata como sucesso.
        let inserted: any = null;
        const insertRes = await sbAdmin
          .from("crm_messages")
          .insert({
            user_id: userId,
            contact_id: contact.id,
            body: parsed.text,
            from_me: true,
            at: new Date().toISOString(),
            type: "text",
            message_id: messageId,
            remote_jid: remoteJid,
            status: evData?.status?.toString().toLowerCase() ?? "sent",
            raw: evData,
          })
          .select("id, contact_id, body, from_me, at")
          .single();

        if (insertRes.error) {
          // 23505 = unique_violation (webhook já gravou antes). Busca a linha existente.
          if (insertRes.error.code === "23505" && messageId) {
            const { data: existing } = await sbAdmin
              .from("crm_messages")
              .select("id, contact_id, body, from_me, at")
              .eq("user_id", userId)
              .eq("message_id", messageId)
              .maybeSingle();
            inserted = existing;
          }
          if (!inserted) {
            return jsonResponse(
              { ok: false, error: "falha ao gravar mensagem", detail: insertRes.error.message },
              500,
            );
          }
        } else {
          inserted = insertRes.data;
        }

        return jsonResponse({
          ok: true,
          message: {
            id: inserted.id,
            contactId: inserted.contact_id,
            body: inserted.body,
            fromMe: inserted.from_me,
            at: inserted.at,
          },
          evolution: { messageId, status: evData?.status ?? null },
        });
        } catch (err: any) {
          console.error("[send-and-log] unhandled", {
            name: err?.name ?? null,
            message: err?.message ?? String(err),
          });
          return jsonResponse(
            { ok: false, error: "falha interna ao enviar", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});

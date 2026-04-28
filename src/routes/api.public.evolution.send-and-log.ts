// POST /api/public/evolution/send-and-log
// Send do Inbox: chama Evolution API + grava em crm_messages atomicamente.
// Auth: Authorization: Bearer <user-jwt>  (do login do Supabase)
// Body: { contactId: "...", text: "..." }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

const Schema = z.object({
  contactId: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

export const Route = createFileRoute("/api/public/evolution/send-and-log")({
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
          .select("id, phone_norm, name")
          .eq("id", parsed.contactId)
          .eq("user_id", userId)
          .maybeSingle();
        if (contactErr || !contact) {
          return jsonResponse({ ok: false, error: "contato não encontrado" }, 404);
        }
        if (!contact.phone_norm) {
          return jsonResponse({ ok: false, error: "contato sem telefone válido" }, 400);
        }

        // Envia via Evolution
        const evRes = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ number: contact.phone_norm, text: parsed.text }),
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
        const remoteJid: string | null = evData?.key?.remoteJid ?? `${contact.phone_norm}@s.whatsapp.net`;

        // Grava (upsert por message_id pra evitar duplicar quando o webhook MESSAGES_UPSERT chegar)
        const { data: inserted, error: insErr } = await sbAdmin
          .from("crm_messages")
          .upsert(
            {
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
            },
            { onConflict: "user_id,message_id", ignoreDuplicates: false },
          )
          .select("id, contact_id, body, from_me, at")
          .single();

        if (insErr) {
          return jsonResponse(
            { ok: false, error: "falha ao gravar mensagem", detail: insErr.message },
            500,
          );
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
      },
    },
  },
});

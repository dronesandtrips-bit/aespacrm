// POST /api/public/evolution/send-media-and-log
// Envia mídia (imagem/documento) via Evolution e registra em crm_messages.
// Auth: Bearer <user-jwt>
// Body: { contactId, mediatype: "image"|"document", media (base64 puro), fileName?, mimetype?, caption? }
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
  mediatype: z.enum(["image", "document"]),
  media: z.string().min(1).max(20_000_000),
  fileName: z.string().trim().min(1).max(255).optional(),
  mimetype: z.string().trim().min(3).max(100).optional(),
  caption: z.string().trim().max(1024).optional(),
  quotedMessageId: z.string().trim().min(1).max(200).optional(),
});

async function buildQuoted(
  sbAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  quotedMessageId: string,
  fallbackRemoteJid: string,
): Promise<any | null> {
  const { data: q } = await sbAdmin
    .from("crm_messages")
    .select("message_id, from_me, remote_jid, body, type, media_caption")
    .eq("user_id", userId)
    .eq("message_id", quotedMessageId)
    .maybeSingle();
  if (!q || !q.message_id) return null;
  const text = q.type === "text" ? (q.body ?? "") : (q.media_caption ?? q.body ?? "");
  return {
    key: {
      id: q.message_id,
      fromMe: !!q.from_me,
      remoteJid: q.remote_jid ?? fallbackRemoteJid,
    },
    message: { conversation: text || "" },
  };
}

export const Route = createFileRoute("/api/public/evolution/send-media-and-log")({
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

          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!token) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

          const userClient = createClient(supaUrl, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            db: { schema: "aespacrm" },
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: userRes, error: authErr } = await userClient.auth.getUser(token);
          if (authErr || !userRes?.user) return jsonResponse({ ok: false, error: "invalid token" }, 401);
          const userId = userRes.user.id;

          let parsed;
          try {
            parsed = Schema.parse(await request.json());
          } catch (e: any) {
            return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
          }

          const sbAdmin = getSupabaseAdmin();
          const { data: contact, error: contactErr } = await sbAdmin
            .from("crm_contacts")
            .select("id, phone_norm, name, is_group, wa_jid")
            .eq("id", parsed.contactId)
            .eq("user_id", userId)
            .maybeSingle();
          if (contactErr || !contact) return jsonResponse({ ok: false, error: "contato não encontrado" }, 404);

          let sendNumber: string;
          if (contact.is_group) {
            if (!contact.wa_jid) return jsonResponse({ ok: false, error: "grupo sem JID" }, 400);
            sendNumber = contact.wa_jid;
          } else {
            if (!contact.phone_norm) return jsonResponse({ ok: false, error: "contato sem telefone válido" }, 400);
            sendNumber = contact.phone_norm;
          }

          const fallbackRemoteJid = contact.is_group ? (contact.wa_jid ?? "") : `${contact.phone_norm}@s.whatsapp.net`;
          const quoted = parsed.quotedMessageId
            ? await buildQuoted(sbAdmin, userId, parsed.quotedMessageId, fallbackRemoteJid)
            : null;
          const evRes = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
            method: "POST",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              number: sendNumber,
              mediatype: parsed.mediatype,
              media: parsed.media,
              caption: parsed.caption,
              fileName: parsed.fileName,
              mimetype: parsed.mimetype,
              ...(quoted ? { quoted } : {}),
            }),
          });
          const evText = await evRes.text();
          let evData: any = evText;
          try { evData = JSON.parse(evText); } catch {}

          if (!evRes.ok) {
            return jsonResponse({ ok: false, status: evRes.status, error: evData }, 502);
          }

          // Evolution às vezes devolve o id em paths diferentes.
          const messageId: string | null =
            evData?.key?.id ??
            evData?.messageId ??
            evData?.id ??
            evData?.message?.key?.id ??
            evData?.data?.key?.id ??
            null;
          const remoteJid: string | null =
            evData?.key?.remoteJid ??
            evData?.message?.key?.remoteJid ??
            evData?.data?.key?.remoteJid ??
            (contact.is_group ? contact.wa_jid : `${contact.phone_norm}@s.whatsapp.net`);

          // Sem messageId não conseguimos baixar o PDF/imagem depois (vira
          // "Documento indisponível" na inbox). Nesse caso, NÃO inserimos
          // placeholder — o webhook messages.upsert criará o registro
          // correto em segundos (com message_id e media_url).
          if (!messageId && parsed.mediatype === "document") {
            return jsonResponse({
              ok: true,
              pending: true,
              note: "documento enviado; aguardando confirmação do WhatsApp",
              evolution: { messageId: null, status: evData?.status ?? null },
            });
          }

          const bodyText = parsed.mediatype === "document"
            ? (parsed.fileName ?? "[documento]")
            : (parsed.caption ?? "[imagem]");

          let inserted: any = null;
          const insertRes = await sbAdmin
            .from("crm_messages")
            .insert({
              user_id: userId,
              contact_id: contact.id,
              body: bodyText,
              from_me: true,
              at: new Date().toISOString(),
              type: parsed.mediatype,
              message_id: messageId,
              remote_jid: remoteJid,
              media_mime: parsed.mimetype ?? null,
              media_caption: parsed.caption ?? null,
              status: evData?.status?.toString().toLowerCase() ?? "sent",
              raw: evData,
            })
            .select("id, contact_id, body, from_me, at, type, media_url, media_mime, media_caption, status")
            .single();

          if (insertRes.error) {
            if (insertRes.error.code === "23505" && messageId) {
              const { data: existing } = await sbAdmin
                .from("crm_messages")
                .select("id, contact_id, body, from_me, at, type, media_url, media_mime, media_caption, status")
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
              type: inserted.type,
              mediaUrl: inserted.media_url ?? null,
              mediaMime: inserted.media_mime ?? null,
              mediaCaption: inserted.media_caption ?? null,
              status: inserted.status ?? null,
            },
            evolution: { messageId, status: evData?.status ?? null },
          });
        } catch (err: any) {
          console.error("[send-media-and-log] unhandled", err?.message ?? err);
          return jsonResponse(
            { ok: false, error: "falha interna ao enviar mídia", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});

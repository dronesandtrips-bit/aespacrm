// POST /api/public/evolution/forward-message
// Encaminha QUALQUER tipo de mensagem (texto, imagem, sticker, áudio) para 1+ contatos.
// Comportamento equivalente ao "Encaminhar" do WhatsApp Web (mensagem nova,
// sem citação). Para mídias, baixa o base64 via Evolution e reenviar via sendMedia.
// Auth: Authorization: Bearer <user-jwt>
// Body: { messageId: string, contactIds: string[] }
//
// IMPORTANTE: rota separada de forward-media (que continua existindo, intacta).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

const Schema = z.object({
  messageId: z.string().trim().min(1).max(200),
  contactIds: z.array(z.string().uuid()).min(1).max(50),
});

export const Route = createFileRoute("/api/public/evolution/forward-message")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: PUBLIC_CORS }),
      POST: async ({ request }) => {
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

        let parsed;
        try {
          parsed = Schema.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "payload inválido", detail: e?.message }, 400);
        }

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

        // Mensagem original
        const { data: srcMsg, error: srcErr } = await userClient
          .from("crm_messages")
          .select("type, body, media_mime, media_caption")
          .eq("message_id", parsed.messageId)
          .maybeSingle();
        if (srcErr || !srcMsg) {
          return jsonResponse({ ok: false, error: "mensagem original não encontrada" }, 404);
        }

        const mediaTypes = new Set(["image", "sticker", "audio"]);
        const isMedia = mediaTypes.has(srcMsg.type);
        const isText = srcMsg.type === "text" || !srcMsg.type;
        if (!isText && !isMedia) {
          return jsonResponse({ ok: false, error: "tipo de mensagem não pode ser encaminhado" }, 403);
        }

        // Para mídia: baixa base64 uma única vez
        let mediaBase64: string | null = null;
        let mediaMime: string = srcMsg.media_mime ?? "image/jpeg";
        if (isMedia) {
          const mediaRes = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${INSTANCE}`, {
            method: "POST",
            headers: { apikey: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ message: { key: { id: parsed.messageId } }, convertToMp4: false }),
          });
          const mediaText = await mediaRes.text();
          let mediaData: any = mediaText;
          try { mediaData = JSON.parse(mediaText); } catch {}
          if (!mediaRes.ok) {
            return jsonResponse({ ok: false, error: "falha ao obter mídia", detail: mediaData }, 502);
          }
          const b64: string | undefined = mediaData?.base64 ?? mediaData?.media ?? mediaData?.data;
          if (!b64) {
            return jsonResponse({ ok: false, error: "sem base64 retornado" }, 502);
          }
          mediaBase64 = b64.replace(/^data:[^;]+;base64,/, "");
          mediaMime = mediaData?.mimetype ?? mediaMime;
        }

        const sbAdmin = getSupabaseAdmin();

        const { data: contacts, error: contactsErr } = await sbAdmin
          .from("crm_contacts")
          .select("id, phone_norm, is_group, wa_jid")
          .eq("user_id", userId)
          .in("id", parsed.contactIds);
        if (contactsErr || !contacts || contacts.length === 0) {
          return jsonResponse({ ok: false, error: "contatos não encontrados" }, 404);
        }

        const results: Array<{ contactId: string; ok: boolean; error?: string }> = [];

        for (const contact of contacts) {
          const sendNumber = contact.is_group ? contact.wa_jid : contact.phone_norm;
          if (!sendNumber) {
            results.push({ contactId: contact.id, ok: false, error: "destino sem número" });
            continue;
          }
          const remoteJidFallback = contact.is_group ? contact.wa_jid : `${contact.phone_norm}@s.whatsapp.net`;

          try {
            let evRes: Response;
            let bodyText = "";
            let insertType = "text";
            let insertMediaMime: string | null = null;
            let insertMediaCaption: string | null = null;

            if (isText) {
              const text = srcMsg.body ?? "";
              if (!text.trim()) {
                results.push({ contactId: contact.id, ok: false, error: "mensagem vazia" });
                continue;
              }
              bodyText = text;
              evRes = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ number: sendNumber, text }),
              });
            } else if (srcMsg.type === "audio") {
              bodyText = "[áudio]";
              insertType = "audio";
              insertMediaMime = mediaMime;
              evRes = await fetch(`${apiUrl}/message/sendWhatsAppAudio/${INSTANCE}`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ number: sendNumber, audio: mediaBase64 }),
              });
            } else {
              // image / sticker → envia como imagem (Evolution sendMedia mediatype: image)
              bodyText = srcMsg.type === "sticker" ? "[sticker]" : "[imagem]";
              insertType = srcMsg.type === "sticker" ? "sticker" : "image";
              insertMediaMime = mediaMime;
              insertMediaCaption = srcMsg.media_caption ?? null;
              evRes = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
                method: "POST",
                headers: { apikey: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  number: sendNumber,
                  mediatype: "image",
                  media: mediaBase64,
                  mimetype: mediaMime,
                  caption: srcMsg.media_caption ?? "",
                }),
              });
            }

            const evText = await evRes.text();
            let evData: any = evText;
            try { evData = JSON.parse(evText); } catch {}
            if (!evRes.ok) {
              results.push({
                contactId: contact.id,
                ok: false,
                error: typeof evData === "string" ? evData : JSON.stringify(evData),
              });
              continue;
            }

            const newMessageId: string | null = evData?.key?.id ?? null;
            const remoteJid: string | null = evData?.key?.remoteJid ?? remoteJidFallback;

            await sbAdmin.from("crm_messages").insert({
              user_id: userId,
              contact_id: contact.id,
              body: bodyText,
              from_me: true,
              at: new Date().toISOString(),
              type: insertType,
              media_mime: insertMediaMime,
              media_caption: insertMediaCaption,
              message_id: newMessageId,
              remote_jid: remoteJid,
              status: evData?.status?.toString().toLowerCase() ?? "sent",
              raw: evData,
            });
            results.push({ contactId: contact.id, ok: true });
          } catch (e: any) {
            results.push({ contactId: contact.id, ok: false, error: e?.message ?? String(e) });
          }
        }

        const okCount = results.filter((r) => r.ok).length;
        return jsonResponse({ ok: okCount > 0, sent: okCount, total: results.length, results });
      },
    },
  },
});

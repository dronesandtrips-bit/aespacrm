// POST /api/public/evolution/forward-media
// Encaminha uma mídia (imagem) recebida para uma lista de contatos.
// Auth: Authorization: Bearer <user-jwt>
// Body: { messageId: string, contactIds: string[], caption?: string }
//
// Fluxo:
//  1) Valida JWT.
//  2) Confere que a mensagem original é do usuário e do tipo image/sticker.
//  3) Pega base64 via Evolution (getBase64FromMediaMessage).
//  4) Pra cada contato, chama /message/sendMedia e grava em crm_messages.
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
  caption: z.string().trim().max(1024).optional(),
});

export const Route = createFileRoute("/api/public/evolution/forward-media")({
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

        // Mensagem original deve ser do usuário e mídia
        const { data: srcMsg, error: srcErr } = await userClient
          .from("crm_messages")
          .select("type, media_mime, media_caption")
          .eq("message_id", parsed.messageId)
          .maybeSingle();
        if (srcErr || !srcMsg) {
          return jsonResponse({ ok: false, error: "mensagem original não encontrada" }, 404);
        }
        if (srcMsg.type !== "image" && srcMsg.type !== "sticker") {
          return jsonResponse({ ok: false, error: "só imagens podem ser encaminhadas" }, 403);
        }

        // Pega base64 via Evolution
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
        const base64: string | undefined = mediaData?.base64 ?? mediaData?.media ?? mediaData?.data;
        const mimetype: string = mediaData?.mimetype ?? srcMsg.media_mime ?? "image/jpeg";
        if (!base64) {
          return jsonResponse({ ok: false, error: "sem base64 retornado" }, 502);
        }
        const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");

        const sbAdmin = getSupabaseAdmin();

        // Busca contatos do usuário
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
          let sendNumber: string | null = null;
          if (contact.is_group) {
            sendNumber = contact.wa_jid ?? null;
          } else {
            sendNumber = contact.phone_norm ?? null;
          }
          if (!sendNumber) {
            results.push({ contactId: contact.id, ok: false, error: "destino sem número" });
            continue;
          }

          try {
            const evRes = await fetch(`${apiUrl}/message/sendMedia/${INSTANCE}`, {
              method: "POST",
              headers: { apikey: apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                number: sendNumber,
                mediatype: "image",
                media: cleanBase64,
                mimetype,
                caption: parsed.caption ?? "",
              }),
            });
            const evText = await evRes.text();
            let evData: any = evText;
            try { evData = JSON.parse(evText); } catch {}
            if (!evRes.ok) {
              results.push({ contactId: contact.id, ok: false, error: typeof evData === "string" ? evData : JSON.stringify(evData) });
              continue;
            }

            const newMessageId: string | null = evData?.key?.id ?? null;
            const remoteJid: string | null =
              evData?.key?.remoteJid ??
              (contact.is_group ? contact.wa_jid : `${contact.phone_norm}@s.whatsapp.net`);

            await sbAdmin.from("crm_messages").insert({
              user_id: userId,
              contact_id: contact.id,
              body: parsed.caption ?? "[imagem]",
              from_me: true,
              at: new Date().toISOString(),
              type: "image",
              media_mime: mimetype,
              media_caption: parsed.caption ?? null,
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

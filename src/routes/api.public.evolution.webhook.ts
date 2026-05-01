// POST /api/public/evolution/webhook
// Recebe webhooks da Evolution API (instância `zapcrm`) e processa:
//   - MESSAGES_UPSERT      → grava mensagem em crm_messages
//   - MESSAGES_UPDATE      → atualiza status da mensagem
//   - CONNECTION_UPDATE    → atualiza crm_instance_state
//   - CONTACTS_UPSERT      → upsert em crm_contacts
//   - CHATS_UPSERT         → ignorado por enquanto (já cobre via contacts)
//
// Segurança: protegido por header `apikey` igual ao EVOLUTION_API_KEY
// (a Evolution envia esse header automaticamente no webhook quando configurado).
//
// Multi-tenant: o ZapCRM tem 1 instância dedicada (`zapcrm`). O dono
// da instância é determinado pela secret EVOLUTION_OWNER_USER_ID.

import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, jsonResponse } from "@/integrations/supabase/server";
import { isStrictValidPhone } from "@/server/phone-validation";

const INSTANCE = "zapcrm";

// Aceita apenas JIDs de contatos individuais do WhatsApp.
// Rejeita grupos (@g.us), broadcast (@broadcast), status, lid (@lid) e qualquer outro.
function isIndividualJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  const s = String(jid).toLowerCase();
  if (!s.includes("@")) return false; // sem domínio, não confiamos
  return s.endsWith("@s.whatsapp.net") || s.endsWith("@c.us");
}

function normalizePhone(jid: string | undefined | null): string {
  if (!jid) return "";
  // 5511999999999@s.whatsapp.net → 5511999999999
  return String(jid).split("@")[0].replace(/\D/g, "");
}

// Validação estrita: E.164 + regras por país (BR=12/13) + anti-lixo.
function isValidE164(phone: string): boolean {
  return isStrictValidPhone(phone);
}

// Sanitiza nome vindo da Evolution: rejeita JIDs, vazios e strings que parecem IDs técnicos.
function sanitizeContactName(rawName: string | undefined | null, phone: string): string {
  const n = (rawName ?? "").toString().trim();
  if (!n) return phone;
  if (n.includes("@")) return phone; // parece JID
  if (/^\d{14,}$/.test(n)) return phone; // ID numérico longo
  if (n.length > 120) return n.slice(0, 120);
  return n;
}

function detectMessageType(msg: any): {
  type: string;
  body: string;
  media_url: string | null;
  media_mime: string | null;
  media_caption: string | null;
} {
  const m = msg?.message ?? {};
  if (m.conversation) {
    return { type: "text", body: m.conversation, media_url: null, media_mime: null, media_caption: null };
  }
  if (m.extendedTextMessage?.text) {
    return { type: "text", body: m.extendedTextMessage.text, media_url: null, media_mime: null, media_caption: null };
  }
  if (m.imageMessage) {
    return {
      type: "image",
      body: m.imageMessage.caption ?? "[imagem]",
      media_url: m.imageMessage.url ?? null,
      media_mime: m.imageMessage.mimetype ?? null,
      media_caption: m.imageMessage.caption ?? null,
    };
  }
  if (m.videoMessage) {
    return {
      type: "video",
      body: m.videoMessage.caption ?? "[vídeo]",
      media_url: m.videoMessage.url ?? null,
      media_mime: m.videoMessage.mimetype ?? null,
      media_caption: m.videoMessage.caption ?? null,
    };
  }
  if (m.audioMessage) {
    return {
      type: "audio",
      body: "[áudio]",
      media_url: m.audioMessage.url ?? null,
      media_mime: m.audioMessage.mimetype ?? null,
      media_caption: null,
    };
  }
  if (m.documentMessage) {
    return {
      type: "document",
      body: m.documentMessage.fileName ?? "[documento]",
      media_url: m.documentMessage.url ?? null,
      media_mime: m.documentMessage.mimetype ?? null,
      media_caption: m.documentMessage.caption ?? null,
    };
  }
  if (m.stickerMessage) {
    return { type: "sticker", body: "[sticker]", media_url: m.stickerMessage.url ?? null, media_mime: m.stickerMessage.mimetype ?? null, media_caption: null };
  }
  if (m.locationMessage) {
    return { type: "location", body: "[localização]", media_url: null, media_mime: null, media_caption: null };
  }
  if (m.reactionMessage) {
    return { type: "reaction", body: m.reactionMessage.text ?? "👍", media_url: null, media_mime: null, media_caption: null };
  }
  return { type: "unknown", body: "[mensagem não suportada]", media_url: null, media_mime: null, media_caption: null };
}

async function ensureContact(
  sb: any,
  userId: string,
  phone: string,
  fallbackName: string,
): Promise<string | null> {
  if (!phone || !isValidE164(phone)) return null;
  const safeName = sanitizeContactName(fallbackName, phone);
  // tenta achar
  const { data: existing } = await sb
    .from("crm_contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("phone_norm", phone)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await sb
    .from("crm_contacts")
    .insert({
      user_id: userId,
      name: safeName,
      phone,
    })
    .select("id")
    .single();
  if (error) {
    console.error("ensureContact insert error", error);
    return null;
  }
  return created.id;
}

export const Route = createFileRoute("/api/public/evolution/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.EVOLUTION_API_KEY?.trim();
        const ownerUserId = process.env.EVOLUTION_OWNER_USER_ID?.trim();

        if (!apiKey || !ownerUserId) {
          return jsonResponse(
            { ok: false, error: "EVOLUTION_API_KEY e EVOLUTION_OWNER_USER_ID são obrigatórios" },
            500,
          );
        }

        // Auth: Evolution envia header `apikey` igual ao da instância
        const got = request.headers.get("apikey") ?? request.headers.get("x-evolution-key");
        if (!got || got !== apiKey) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }

        let payload: any;
        try {
          payload = await request.json();
        } catch (e: any) {
          return jsonResponse({ ok: false, error: "invalid json" }, 400);
        }

        const event: string = String(payload?.event ?? "").toLowerCase();
        const instance: string = String(payload?.instance ?? INSTANCE);

        if (instance && instance !== INSTANCE) {
          // Não é a nossa instância — ignora (proteção isolamento)
          return jsonResponse({ ok: true, ignored: true, reason: "other instance" });
        }

        const sb = getSupabaseAdmin();

        // Log bruto (best effort)
        sb.from("crm_webhook_events")
          .insert({ user_id: ownerUserId, instance, event, payload })
          .then(() => {})
          .catch(() => {});

        try {
          if (event === "messages.upsert") {
            const arr = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
            for (const msg of arr) {
              const remoteJid: string = msg?.key?.remoteJid ?? "";
              // só contatos individuais — ignora grupos, broadcast, status, lid
              if (!isIndividualJid(remoteJid)) continue;
              const phone = normalizePhone(remoteJid);
              if (!isValidE164(phone)) continue;
              const fromMe: boolean = !!msg?.key?.fromMe;
              const messageId: string = msg?.key?.id ?? "";
              // IMPORTANTE: quando fromMe=true, pushName é o nome do DONO da instância
              // (você), não do destinatário. Ignorar nesse caso para não poluir contatos
              // novos com "Jones Hahn". A IA preenche o nome real depois via enrich.
              const pushName: string = fromMe ? "" : (msg?.pushName ?? "");
              const ts = msg?.messageTimestamp
                ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
                : new Date().toISOString();

              const contactId = await ensureContact(sb, ownerUserId, phone, pushName);
              if (!contactId) continue;

              const parsed = detectMessageType(msg);

              await sb.from("crm_messages").upsert(
                {
                  user_id: ownerUserId,
                  contact_id: contactId,
                  body: parsed.body,
                  from_me: fromMe,
                  at: ts,
                  message_id: messageId || null,
                  remote_jid: remoteJid,
                  type: parsed.type,
                  media_url: parsed.media_url,
                  media_mime: parsed.media_mime,
                  media_caption: parsed.media_caption,
                  status: msg?.status ?? null,
                  raw: msg,
                },
                { onConflict: "user_id,message_id", ignoreDuplicates: false },
              );

              // Pausa sequências ativas se for resposta inbound
              if (!fromMe) {
                await sb
                  .from("crm_contact_sequences")
                  .update({
                    status: "paused",
                    paused_at: new Date().toISOString(),
                    pause_reason: "inbound_reply",
                  })
                  .eq("user_id", ownerUserId)
                  .eq("contact_id", contactId)
                  .eq("status", "active");
              }
            }
          } else if (event === "messages.update") {
            const arr = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
            for (const upd of arr) {
              const messageId = upd?.key?.id ?? upd?.keyId;
              const status = upd?.status ?? upd?.update?.status;
              if (!messageId || !status) continue;
              await sb
                .from("crm_messages")
                .update({ status: String(status).toLowerCase() })
                .eq("user_id", ownerUserId)
                .eq("message_id", messageId);
            }
          } else if (event === "connection.update") {
            const state: string = String(payload?.data?.state ?? payload?.state ?? "").toLowerCase();
            if (state) {
              await sb.from("crm_instance_state").upsert(
                {
                  user_id: ownerUserId,
                  instance,
                  state,
                  last_event_at: new Date().toISOString(),
                },
                { onConflict: "user_id" },
              );
            }
          } else if (event === "contacts.upsert" || event === "contacts.update") {
            const arr = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
            for (const c of arr) {
              const remoteJid = c?.id ?? c?.remoteJid;
              if (!isIndividualJid(remoteJid)) continue;
              const phone = normalizePhone(remoteJid);
              if (!isValidE164(phone)) continue;
              const name = c?.pushName ?? c?.name ?? c?.notify ?? phone;
              await ensureContact(sb, ownerUserId, phone, name);
            }
          }
          // chats.upsert: por enquanto não fazemos nada — contatos cobrem
        } catch (err: any) {
          console.error("webhook handler error", err);
          await sb
            .from("crm_webhook_events")
            .update({ error: err?.message ?? String(err) })
            .eq("user_id", ownerUserId)
            .eq("event", event)
            .order("received_at", { ascending: false })
            .limit(1);
          return jsonResponse({ ok: false, error: err?.message ?? String(err) }, 500);
        }

        return jsonResponse({ ok: true, event });
      },
    },
  },
});

// POST /api/public/evolution/sync-messages
// Importa o histórico recente de conversas dos contatos JÁ EXISTENTES no CRM.
//
// Estratégia (conservadora, baixo risco de ban / sobrecarga):
//  1) Busca todos os contatos individuais do usuário (não-grupos) que têm wa_jid.
//  2) Para cada contato, chama POST /chat/findMessages/{instance} com filtro
//     de timestamp >= since (default: últimos 7 dias).
//  3) Faz upsert em crm_messages usando a mesma chave (user_id, message_id) do
//     webhook — então roda 2x não duplica.
//  4) Processa em LOTES com pausa entre eles para não martelar a Evolution.
//     Como é a SUA Evolution, não há risco de ban do WhatsApp (ela só lê o
//     cache local do baileys), mas o delay protege a instância de travar.
//
// Limites de segurança (hardcoded):
//   - Máx 14 dias para trás (não puxa histórico antigo demais)
//   - Lote de 25 contatos por vez, 400ms de pausa entre lotes
//   - Máx 200 mensagens por contato (cap pra não explodir grupos ativos)
//   - Total máximo 5000 mensagens importadas por execução
//
// Auth: Authorization: Bearer <user-jwt>
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, jsonResponse, PUBLIC_CORS } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";
const CONTACT_BATCH_SIZE = 25;
const BATCH_DELAY_MS = 400;
const MAX_MESSAGES_PER_CONTACT = 200;
const MAX_TOTAL_MESSAGES = 5000;
const MAX_DAYS = 14;

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Detecta tipo + corpo de uma mensagem do baileys (replica a lógica simplificada
// do webhook). Apenas o essencial — o webhook tem a versão completa.
function detectMessageType(msg: any): {
  body: string;
  type: string;
  media_url: string | null;
  media_mime: string | null;
  media_caption: string | null;
} {
  const m = msg?.message ?? {};
  if (m.conversation) {
    return { body: String(m.conversation), type: "text", media_url: null, media_mime: null, media_caption: null };
  }
  if (m.extendedTextMessage?.text) {
    return { body: String(m.extendedTextMessage.text), type: "text", media_url: null, media_mime: null, media_caption: null };
  }
  if (m.imageMessage) {
    const cap = m.imageMessage.caption ?? null;
    return {
      body: cap ?? "[imagem]",
      type: "image",
      media_url: m.imageMessage.url ?? null,
      media_mime: m.imageMessage.mimetype ?? "image/jpeg",
      media_caption: cap,
    };
  }
  if (m.videoMessage) {
    const cap = m.videoMessage.caption ?? null;
    return {
      body: cap ?? "[vídeo]",
      type: "video",
      media_url: m.videoMessage.url ?? null,
      media_mime: m.videoMessage.mimetype ?? "video/mp4",
      media_caption: cap,
    };
  }
  if (m.audioMessage) {
    return {
      body: "[áudio]",
      type: "audio",
      media_url: m.audioMessage.url ?? null,
      media_mime: m.audioMessage.mimetype ?? "audio/ogg",
      media_caption: null,
    };
  }
  if (m.documentMessage) {
    return {
      body: m.documentMessage.fileName ?? "[documento]",
      type: "document",
      media_url: m.documentMessage.url ?? null,
      media_mime: m.documentMessage.mimetype ?? null,
      media_caption: m.documentMessage.caption ?? null,
    };
  }
  if (m.stickerMessage) {
    return { body: "[sticker]", type: "sticker", media_url: m.stickerMessage.url ?? null, media_mime: "image/webp", media_caption: null };
  }
  if (m.locationMessage) {
    return { body: "[localização]", type: "location", media_url: null, media_mime: null, media_caption: null };
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return { body: "[contato]", type: "contact", media_url: null, media_mime: null, media_caption: null };
  }
  // fallback genérico
  return { body: "[mensagem]", type: "unknown", media_url: null, media_mime: null, media_caption: null };
}

// Tenta extrair lista de mensagens da resposta da Evolution.
// Versões diferentes retornam:
//   - array direto
//   - { messages: { records: [...] } }
//   - { records: [...] }
function extractMessages(j: any): any[] {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.messages?.records)) return j.messages.records;
  if (Array.isArray(j?.records)) return j.records;
  if (Array.isArray(j?.messages)) return j.messages;
  return [];
}

export const Route = createFileRoute("/api/public/evolution/sync-messages")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: PUBLIC_CORS }),

      POST: async ({ request }) => {
        try {
          const apiUrl = process.env.EVOLUTION_API_URL
            ? normalizeUrl(process.env.EVOLUTION_API_URL)
            : "";
          const apiKey = process.env.EVOLUTION_API_KEY?.trim();
          const supaUrl = process.env.AESPACRM_SUPA_URL
            ? normalizeUrl(process.env.AESPACRM_SUPA_URL)
            : "";
          const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
          if (!apiUrl || !apiKey || !supaUrl || !anonKey) {
            return jsonResponse({ ok: false, error: "config faltando no servidor" }, 500);
          }

          // Auth
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

          // Body opcional: { days?: number }
          let days = 7;
          try {
            const body = await request.json().catch(() => null);
            const d = Number(body?.days);
            if (Number.isFinite(d) && d > 0) days = Math.min(d, MAX_DAYS);
          } catch {
            /* ignore */
          }

          const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
          const sinceSec = Math.floor(sinceMs / 1000);

          // 1) Lista contatos individuais existentes do usuário com wa_jid
          const sbAdmin = getSupabaseAdmin();
          const { data: contacts, error: contactsErr } = await sbAdmin
            .from("crm_contacts")
            .select("id, wa_jid, phone_norm, phone")
            .eq("user_id", userId)
            .eq("is_group", false)
            .not("wa_jid", "is", null);

          if (contactsErr) {
            return jsonResponse(
              { ok: false, error: "contacts_query_failed", detail: contactsErr.message },
              500,
            );
          }

          type ContactRow = { id: string; wa_jid: string | null; phone_norm: string | null; phone: string | null };
          const targets = ((contacts ?? []) as ContactRow[]).filter(
            (c): c is ContactRow & { wa_jid: string } =>
              typeof c.wa_jid === "string" && c.wa_jid.includes("@s.whatsapp.net"),
          );

          if (!targets.length) {
            return jsonResponse({
              ok: true,
              days,
              contactsScanned: 0,
              messagesImported: 0,
              message: "Nenhum contato com WhatsApp identificado. Sincronize os contatos primeiro.",
            });
          }

          // 2) Para cada contato, busca mensagens em lotes
          let messagesImported = 0;
          let messagesSkipped = 0;
          let contactsWithMessages = 0;
          let contactsScanned = 0;
          let evolutionErrors = 0;
          const errorSamples: string[] = [];
          let stoppedEarly = false;

          for (let i = 0; i < targets.length; i += CONTACT_BATCH_SIZE) {
            if (messagesImported >= MAX_TOTAL_MESSAGES) {
              stoppedEarly = true;
              break;
            }
            const batch = targets.slice(i, i + CONTACT_BATCH_SIZE);

            await Promise.all(
              batch.map(async (contact) => {
                if (messagesImported >= MAX_TOTAL_MESSAGES) return;
                contactsScanned++;
                const remoteJid = contact.wa_jid as string;

                // Body que a Evolution v2 aceita pra findMessages.
                // Filtros equivalentes: where.key.remoteJid + where.messageTimestamp.
                let evMsgs: any[] = [];
                try {
                  const r = await fetch(`${apiUrl}/chat/findMessages/${INSTANCE}`, {
                    method: "POST",
                    headers: { apikey: apiKey, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      where: {
                        key: { remoteJid },
                        messageTimestamp: { gte: sinceSec },
                      },
                      limit: MAX_MESSAGES_PER_CONTACT,
                    }),
                  });
                  if (!r.ok) {
                    evolutionErrors++;
                    if (errorSamples.length < 3) {
                      const t = await r.text().catch(() => "");
                      errorSamples.push(`HTTP ${r.status} jid=${remoteJid.slice(0, 20)} ${t.slice(0, 150)}`);
                    }
                    return;
                  }
                  const j = await r.json().catch(() => null);
                  evMsgs = extractMessages(j);
                } catch (err: any) {
                  evolutionErrors++;
                  if (errorSamples.length < 3) errorSamples.push(err?.message ?? String(err));
                  return;
                }

                if (!evMsgs.length) return;

                // Filtra por timestamp client-side (segurança extra) e monta as rows
                const rows: any[] = [];
                for (const msg of evMsgs) {
                  const ts = msg?.messageTimestamp ?? msg?.message_timestamp;
                  if (!ts) continue;
                  const tsNum = Number(ts);
                  if (!Number.isFinite(tsNum) || tsNum * 1000 < sinceMs) {
                    messagesSkipped++;
                    continue;
                  }
                  const messageId: string = msg?.key?.id ?? msg?.keyId ?? "";
                  if (!messageId) {
                    messagesSkipped++;
                    continue;
                  }
                  const fromMe: boolean = !!(msg?.key?.fromMe ?? msg?.fromMe);
                  const parsed = detectMessageType(msg);
                  rows.push({
                    user_id: userId,
                    contact_id: contact.id,
                    body: parsed.body,
                    from_me: fromMe,
                    at: new Date(tsNum * 1000).toISOString(),
                    message_id: messageId,
                    remote_jid: remoteJid,
                    type: parsed.type,
                    media_url: parsed.media_url,
                    media_mime: parsed.media_mime,
                    media_caption: parsed.media_caption,
                    status: msg?.status ?? null,
                    raw: msg,
                  });
                  if (rows.length >= MAX_MESSAGES_PER_CONTACT) break;
                }

                if (!rows.length) return;

                // Upsert pelo mesmo conflict do webhook → idempotente
                const { error: upErr } = await sbAdmin
                  .from("crm_messages")
                  .upsert(rows, { onConflict: "user_id,message_id", ignoreDuplicates: false });

                if (upErr) {
                  evolutionErrors++;
                  if (errorSamples.length < 3) errorSamples.push(`db: ${upErr.message}`);
                  return;
                }
                messagesImported += rows.length;
                contactsWithMessages++;
              }),
            );

            // Pausa entre lotes pra não sobrecarregar a Evolution
            if (i + CONTACT_BATCH_SIZE < targets.length) {
              await sleep(BATCH_DELAY_MS);
            }
          }

          return jsonResponse({
            ok: true,
            days,
            totalContacts: targets.length,
            contactsScanned,
            contactsWithMessages,
            messagesImported,
            messagesSkipped,
            evolutionErrors,
            stoppedEarly,
            lastError: errorSamples[0] ?? null,
            message: stoppedEarly
              ? `Limite de ${MAX_TOTAL_MESSAGES} mensagens atingido. Rode novamente para continuar.`
              : undefined,
          });
        } catch (err: any) {
          console.error("[sync-messages] unhandled", err?.message ?? err);
          return jsonResponse(
            { ok: false, error: "internal", detail: err?.message ?? String(err) },
            500,
          );
        }
      },
    },
  },
});

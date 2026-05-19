// Lógica compartilhada de opt-out (descadastro).
// - Geração e verificação de tokens HMAC por contato (link clicável).
// - performOptOut: insere na blacklist e envia confirmação via Evolution.
//
// Esta função é o ÚNICO ponto de verdade para descadastro. Usada tanto
// pela página de confirmação (/u/$token) quanto por qualquer fluxo
// futuro.
//
// Token format: base64url(payload).base64url(sig)
//   payload = `${userId}|${phone}|${createdAtSec}`
//   sig     = HMAC-SHA256(secret_do_usuario, payload)
//
// O segredo por usuário fica em aespacrm.crm_user_settings.optout_secret
// (gerado automaticamente via migration). Assim, mesmo se alguém vazar
// um token, só vale para AQUELE par (user_id, phone) — não dá pra forjar
// outros porque a chave HMAC é por usuário e nunca sai do servidor.

import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/integrations/supabase/server";

const INSTANCE = "zapcrm";

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

async function getUserSecret(userId: string): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("crm_user_settings")
    .select("optout_secret")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.optout_secret as string) ?? null;
}

export async function generateOptoutToken(userId: string, phone: string): Promise<string | null> {
  const secret = await getUserSecret(userId);
  if (!secret || !userId || !phone) return null;
  const payload = `${userId}|${phone}|${Math.floor(Date.now() / 1000)}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export async function verifyOptoutToken(
  token: string,
): Promise<{ userId: string; phone: string } | null> {
  try {
    const [payloadB64, sigB64] = String(token ?? "").split(".");
    if (!payloadB64 || !sigB64) return null;
    const payload = b64urlDecode(payloadB64).toString("utf8");
    const parts = payload.split("|");
    if (parts.length !== 3) return null;
    const [userId, phone] = parts;
    if (!userId || !phone) return null;

    const secret = await getUserSecret(userId);
    if (!secret) return null;

    const expected = createHmac("sha256", secret).update(payload).digest();
    const got = b64urlDecode(sigB64);
    if (expected.length !== got.length) return null;
    if (!timingSafeEqual(expected, got)) return null;

    // Sem expiração: o link de descadastro deve valer para sempre, como
    // é padrão em e-mail marketing (lista do GDPR/LGPD).
    return { userId, phone };
  } catch {
    return null;
  }
}

// Resolve um short code (ex: "Ab3xK9pQ") para { userId, phone }.
// Retorna null se não existir ou estiver expirado.
export async function resolveShortCode(
  code: string,
): Promise<{ userId: string; phone: string } | null> {
  if (!code || typeof code !== "string" || code.length < 4) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("crm_optout_shortlinks")
    .select("user_id, phone_norm")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;
  // Se houver expiração, respeita.
  // (A migration não impõe expiração por padrão.)
  return { userId: String(data.user_id), phone: String(data.phone_norm) };
}

function makeShortCode(): string {
  // 6 bytes = 48 bits → ~8 chars base64url (sem padding).
  return randomBytes(6).toString("base64url").slice(0, 8);
}

// Gera um shortlink único para o par (userId, phone).
// Retorna o code ou null se falhar.
export async function generateShortLink(
  userId: string,
  phone: string,
): Promise<string | null> {
  if (!userId || !phone) return null;
  const sb = getSupabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeShortCode();
    const { error } = await sb.from("crm_optout_shortlinks").insert({
      user_id: userId,
      phone_norm: phone,
      code,
    });
    if (!error) return code;
    // Conflito de código (duplicado) → tenta de novo.
    if (!error.message?.toLowerCase().includes("duplicate") && !error.code?.includes("23505")) {
      console.error("[optout] generateShortLink insert error", error);
      break;
    }
  }
  return null;
}

// Monta a URL curta pública para o cliente.
export function buildShortOptoutUrl(code: string): string {
  const base =
    process.env.ZAPCRM_PUBLIC_URL?.trim().replace(/\/+$/, "") ??
    "https://crm.aespa.com.br";
  return `${base}/d/${code}`;
}

// Monta a URL pública clicável para o cliente (legacy — token longo).
export function buildOptoutUrl(token: string): string {
  const base =
    process.env.ZAPCRM_PUBLIC_URL?.trim().replace(/\/+$/, "") ??
    "https://crm.aespa.com.br";
  return `${base}/u/${token}`;
}

// Helper conveniente para usar nos disparos: gera direto a URL CURTA.
// Se o shortlink falhar, cai para o token HMAC longo como fallback.
export async function buildOptoutUrlFor(userId: string, phone: string): Promise<string> {
  const code = await generateShortLink(userId, phone);
  if (code) return buildShortOptoutUrl(code);
  const token = await generateOptoutToken(userId, phone);
  if (!token) return "";
  return buildOptoutUrl(token);
}

// Insere telefone na blacklist e envia confirmação via WhatsApp.
// Idempotente: se já estiver na blacklist, NÃO reenvia confirmação.
// Retorna { ok, alreadyOptedOut } para o caller decidir mensagem ao usuário.
export async function performOptOut(opts: {
  userId: string;
  phone: string;
  source: string; // ex: "link_click", "manual_admin"
  sendConfirmation?: boolean; // default true
}): Promise<{ ok: boolean; alreadyOptedOut: boolean; error?: string }> {
  const { userId, phone, source } = opts;
  const sendConfirmation = opts.sendConfirmation !== false;
  if (!userId || !phone) return { ok: false, alreadyOptedOut: false, error: "missing params" };

  const sb = getSupabaseAdmin();

  // Verifica se já estava na blacklist (idempotência).
  const { data: existing } = await sb
    .from("crm_ignored_phones")
    .select("id")
    .eq("user_id", userId)
    .eq("phone_norm", phone)
    .maybeSingle();
  const alreadyOptedOut = !!existing?.id;

  if (!alreadyOptedOut) {
    const { error: insErr } = await sb.from("crm_ignored_phones").upsert(
      {
        user_id: userId,
        phone_norm: phone,
        reason: `whatsapp:${source}`,
      },
      { onConflict: "user_id,phone_norm", ignoreDuplicates: true },
    );
    if (insErr) {
      console.error("[optout] insert blacklist error", insErr);
      return { ok: false, alreadyOptedOut: false, error: insErr.message };
    }

    // Pausa sequências ativas para esse contato.
    const { data: contact } = await sb
      .from("crm_contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("phone_norm", phone)
      .eq("is_group", false)
      .maybeSingle();
    if (contact?.id) {
      await sb
        .from("crm_contact_sequences")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          pause_reason: "opt_out",
        })
        .eq("user_id", userId)
        .eq("contact_id", contact.id)
        .eq("status", "active");
    }
  }

  if (sendConfirmation && !alreadyOptedOut) {
    await sendWhatsAppText(
      phone,
      "✅ Pronto! Você foi descadastrado e não receberá mais mensagens automáticas.",
    );
  }

  return { ok: true, alreadyOptedOut };
}

// Remove da blacklist (re-opt-in). Idempotente.
export async function performOptIn(opts: {
  userId: string;
  phone: string;
  sendConfirmation?: boolean;
}): Promise<{ ok: boolean; wasOptedOut: boolean; error?: string }> {
  const { userId, phone } = opts;
  const sendConfirmation = opts.sendConfirmation !== false;
  if (!userId || !phone) return { ok: false, wasOptedOut: false, error: "missing params" };

  const sb = getSupabaseAdmin();
  const { data: removed, error: delErr } = await sb
    .from("crm_ignored_phones")
    .delete()
    .eq("user_id", userId)
    .eq("phone_norm", phone)
    .select("id");
  if (delErr) {
    console.error("[optout] delete blacklist error", delErr);
    return { ok: false, wasOptedOut: false, error: delErr.message };
  }
  const wasOptedOut = !!(removed && removed.length > 0);

  if (sendConfirmation && wasOptedOut) {
    await sendWhatsAppText(
      phone,
      "✅ Você voltou a receber nossas mensagens. Obrigado!",
    );
  }

  return { ok: true, wasOptedOut };
}

async function sendWhatsAppText(number: string, text: string): Promise<void> {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey || !number) {
    console.error("[optout] sendWhatsAppText: missing config");
    return;
  }
  try {
    const r = await fetch(`${apiUrl}/message/sendText/${INSTANCE}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number, text, delay: 800 }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[optout] sendWhatsAppText failed", r.status, t.slice(0, 300));
    }
  } catch (e) {
    console.error("[optout] sendWhatsAppText error", e);
  }
}

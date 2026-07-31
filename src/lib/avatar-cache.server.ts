// Cache de fotos de perfil do WhatsApp no Supabase Storage.
//
// Motivo: as URLs do CDN do WhatsApp (pps.whatsapp.net) expiram e passam a
// responder 403, fazendo o avatar sumir e poluir o console do navegador.
// Aqui baixamos a imagem enquanto o link ainda é válido e servimos a cópia
// de um bucket público do próprio Supabase (cache longo, sem expiração).
//
// Server-only. Nunca importar de componentes.

export const AVATAR_BUCKET = "crm-avatars";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

function normalizeSupabaseUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getConfig(): { url: string; key: string } | null {
  const raw = process.env.AESPACRM_SUPA_URL;
  const key = process.env.AESPACRM_SUPA_SERVICE_KEY?.trim();
  if (!raw || !key) return null;
  const url = normalizeSupabaseUrl(raw);
  if (!url) return null;
  return { url, key };
}

/** URL já é uma cópia nossa no storage? */
export function isCachedAvatarUrl(value: string | null | undefined): boolean {
  return Boolean(value && value.includes(`/storage/v1/object/public/${AVATAR_BUCKET}/`));
}

let bucketReady = false;

/** Cria o bucket público (idempotente). */
export async function ensureAvatarBucket(): Promise<boolean> {
  if (bucketReady) return true;
  const cfg = getConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: AVATAR_BUCKET,
        name: AVATAR_BUCKET,
        public: true,
        file_size_limit: MAX_BYTES,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      }),
    });
    // 200 = criado; 409 = já existe
    if (res.ok || res.status === 409) {
      bucketReady = true;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Baixa `sourceUrl` e guarda no bucket como `<userId>/<contactId>.<ext>`.
 * Retorna a URL pública da cópia, ou null se falhar (best effort).
 */
export async function cacheAvatarFromUrl(
  userId: string,
  contactId: string,
  sourceUrl: string,
): Promise<string | null> {
  const cfg = getConfig();
  if (!cfg) return null;
  if (!/^https?:\/\//i.test(sourceUrl)) return null;
  if (isCachedAvatarUrl(sourceUrl)) return sourceUrl;
  if (!(await ensureAvatarBucket())) return null;

  try {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) return null;
    const mime = (imgRes.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return null;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;

    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/${contactId}.${ext}`;

    const upRes = await fetch(`${cfg.url}/storage/v1/object/${AVATAR_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": mime,
        "cache-control": "public, max-age=31536000, immutable",
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!upRes.ok) return null;

    // cache-buster leve para o navegador pegar a versão nova quando trocar a foto
    const v = Date.now().toString(36);
    return `${cfg.url}/storage/v1/object/public/${AVATAR_BUCKET}/${path}?v=${v}`;
  } catch {
    return null;
  }
}

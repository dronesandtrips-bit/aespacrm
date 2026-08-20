// Cache + fila de download das mídias do WhatsApp (imagens, áudios, documentos).
//
// Problema que isto resolve: a inbox montava dezenas de <SecureImage>/<SecureAudio>
// ao mesmo tempo e cada um disparava um POST para /api/public/evolution/media.
// A Evolution API descriptografa a mídia uma a uma; com 20+ pedidos simultâneos
// ela engasga e vários retornam erro/timeout ("Falha ao carregar imagem").
//
// Aqui centralizamos:
//  - cache em memória por messageId (não rebaixa ao rolar a lista)
//  - deduplicação de pedidos em voo
//  - limite de concorrência (poucos downloads simultâneos, o resto na fila)
//  - retry automático com backoff
//
// INTEGRIDADE: o endpoint do servidor continua o mesmo; só mudou o cliente.

import { getSupabaseClient } from "@/lib/db";

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 2;
const TIMEOUT_MS = 45_000;
const MAX_CACHE = 120;

type Entry = { url: string; mime: string };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

function remember(messageId: string, entry: Entry) {
  cache.set(messageId, entry);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest && oldest !== messageId) {
      const old = cache.get(oldest);
      if (old) URL.revokeObjectURL(old.url);
      cache.delete(oldest);
    }
  }
}

async function download(messageId: string): Promise<Entry> {
  const c = await getSupabaseClient();
  if (!c) throw new Error("sem sessão");
  const sess = await c.auth.getSession();
  const token = sess?.data?.session?.access_token;
  if (!token) throw new Error("sem token");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `/api/public/evolution/media?messageId=${encodeURIComponent(messageId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error("mídia vazia");
      return { url: URL.createObjectURL(blob), mime: blob.type };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("falha ao baixar mídia");
}

/** Baixa (ou reaproveita do cache) a mídia de uma mensagem. */
export async function loadMedia(messageId: string): Promise<Entry> {
  const hit = cache.get(messageId);
  if (hit) return hit;

  const running = inflight.get(messageId);
  if (running) return running;

  const p = (async () => {
    await acquire();
    try {
      const entry = await download(messageId);
      remember(messageId, entry);
      return entry;
    } finally {
      release();
      inflight.delete(messageId);
    }
  })();

  inflight.set(messageId, p);
  return p;
}

/** Esquece a mídia (usado no "tentar novamente"). */
export function forgetMedia(messageId: string) {
  const hit = cache.get(messageId);
  if (hit) URL.revokeObjectURL(hit.url);
  cache.delete(messageId);
}

export function getCachedMedia(messageId: string): Entry | null {
  return cache.get(messageId) ?? null;
}

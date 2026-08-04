// fetch autenticado (JWT do Supabase) com retry em 401 — uso em telas do CRM.
import { getSupabaseClient } from "@/integrations/supabase/client";

async function freshToken(force = false): Promise<string> {
  const c = await getSupabaseClient();
  if (!c) throw new Error("Supabase não configurado");
  let { data } = await c.auth.getSession();
  let session = data.session;
  const expiresAt = session?.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (force || !session || expiresAt - nowSec < 120) {
    const refreshed = await c.auth.refreshSession();
    if (refreshed.data.session) session = refreshed.data.session;
  }
  const token = session?.access_token;
  if (!token) throw new Error("sessão expirada — faça login novamente");
  return token;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await freshToken()}`);
  const first = await fetch(input, { ...init, headers });
  if (first.status !== 401) return first;
  const retry = new Headers(init.headers);
  retry.set("Authorization", `Bearer ${await freshToken(true)}`);
  return fetch(input, { ...init, headers: retry });
}

// Cliente Supabase server-side (service role) para endpoints públicos
// chamados pelo n8n. BYPASSA RLS — sempre filtre por user_id manualmente!
import { createClient } from "@supabase/supabase-js";

let admin: any = null;

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

export function getSupabaseAdmin() {
  if (admin) return admin;
  const rawUrl = process.env.AESPACRM_SUPA_URL;
  const serviceKey = process.env.AESPACRM_SUPA_SERVICE_KEY;
  if (!rawUrl || !serviceKey) {
    throw new Error(
      "AESPACRM_SUPA_URL e AESPACRM_SUPA_SERVICE_KEY são obrigatórios para endpoints server-side",
    );
  }
  const url = normalizeSupabaseUrl(rawUrl);
  if (!url) {
    throw new Error("AESPACRM_SUPA_URL precisa ser uma URL HTTP/HTTPS válida");
  }
  admin = createClient<any, "aespacrm">(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "aespacrm" },
  });
  return admin;
}

export function checkApiKey(request: Request): boolean {
  const expected = process.env.N8N_API_KEY;
  if (!expected) return false;
  const got = request.headers.get("x-api-key");
  return Boolean(got && got === expected);
}

// Valida o JWT do usuário (login Supabase) presente em "Authorization: Bearer <token>".
// Retorna { userId } se válido, ou { error, status } caso contrário.
export async function requireUserJwt(
  request: Request,
): Promise<{ userId: string } | { error: string; status: number }> {
  const supaUrl = process.env.AESPACRM_SUPA_URL;
  const anonKey = process.env.AESPACRM_SUPA_ANON_KEY?.trim();
  if (!supaUrl || !anonKey) return { error: "auth config missing", status: 500 };
  const url = normalizeSupabaseUrl(supaUrl);
  if (!url) return { error: "auth config missing", status: 500 };

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "unauthorized", status: 401 };

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return { error: "invalid token", status: 401 };
  return { userId: data.user.id };
}

export const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...PUBLIC_CORS },
  });
}

// Cliente Supabase server-side (service role) para endpoints públicos
// chamados pelo n8n. BYPASSA RLS — sempre filtre por user_id manualmente!
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.AESPACRM_SUPA_URL;
  const serviceKey = process.env.AESPACRM_SUPA_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "AESPACRM_SUPA_URL e AESPACRM_SUPA_SERVICE_KEY são obrigatórios para endpoints server-side",
    );
  }
  admin = createClient(url, serviceKey, {
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

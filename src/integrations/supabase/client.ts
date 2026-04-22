import { createClient } from "@supabase/supabase-js";

// Variáveis públicas (anon key + URL) — seguras no frontend
const SUPABASE_URL = import.meta.env.VITE_AESPACRM_SUPA_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_AESPACRM_SUPA_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] VITE_AESPACRM_SUPA_URL ou VITE_AESPACRM_SUPA_ANON_KEY ausentes. Configure-as nas variáveis de build.",
  );
}

export const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
  db: {
    schema: "aespacrm",
  },
});

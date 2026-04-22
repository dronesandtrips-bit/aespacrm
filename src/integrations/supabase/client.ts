import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_AESPACRM_SUPA_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_AESPACRM_SUPA_ANON_KEY as string | undefined;
const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] VITE_AESPACRM_SUPA_URL ou VITE_AESPACRM_SUPA_ANON_KEY ausentes. O app vai abrir, mas o login só funciona depois que as variáveis de build forem configuradas.",
  );
}

export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL! : "https://placeholder.invalid",
  isSupabaseConfigured ? SUPABASE_ANON_KEY! : "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
    db: {
      schema: "aespacrm",
    },
  },
);

export { isSupabaseConfigured };

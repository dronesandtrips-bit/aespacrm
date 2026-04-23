import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";

type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

const getRuntimeSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.AESPACRM_SUPA_URL;
  const anonKey = process.env.AESPACRM_SUPA_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey } satisfies PublicSupabaseConfig;
});

const BUILD_SUPABASE_URL = import.meta.env.VITE_AESPACRM_SUPA_URL as string | undefined;
const BUILD_SUPABASE_ANON_KEY = import.meta.env.VITE_AESPACRM_SUPA_ANON_KEY as string | undefined;
const hasBuildConfig = Boolean(BUILD_SUPABASE_URL && BUILD_SUPABASE_ANON_KEY);

let supabase: ReturnType<typeof createBrowserClient> | null = hasBuildConfig
  ? createBrowserClient(BUILD_SUPABASE_URL!, BUILD_SUPABASE_ANON_KEY!)
  : null;

let configPromise: Promise<PublicSupabaseConfig | null> | null = null;

function createBrowserClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
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
}

async function fetchRuntimeConfig(): Promise<PublicSupabaseConfig | null> {
  if (hasBuildConfig) {
    return {
      url: BUILD_SUPABASE_URL!,
      anonKey: BUILD_SUPABASE_ANON_KEY!,
    };
  }

  if (typeof window === "undefined") {
    return null;
  }

  if (!configPromise) {
    configPromise = getRuntimeSupabaseConfig().catch((error) => {
      configPromise = null;
      // eslint-disable-next-line no-console
      console.warn("[supabase] runtime config error:", error);
      return null;
    });
  }

  return configPromise;
}

export async function getSupabaseClient() {
  if (supabase) return supabase;

  const config = await fetchRuntimeConfig();
  if (!config) return null;

  supabase = createBrowserClient(config.url, config.anonKey);
  return supabase;
}

export function getSupabaseClientSync() {
  return supabase;
}


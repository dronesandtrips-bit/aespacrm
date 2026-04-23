import { createClient } from "@supabase/supabase-js";

type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

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
    return { url: BUILD_SUPABASE_URL!, anonKey: BUILD_SUPABASE_ANON_KEY! };
  }

  if (typeof window === "undefined") return null;

  if (!configPromise) {
    configPromise = (async () => {
      try {
        const res = await fetch("/api/public/supabase-config", {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          // eslint-disable-next-line no-console
          console.warn("[supabase] runtime config HTTP", res.status, body);
          configPromise = null;
          return null;
        }
        const data = (await res.json()) as Partial<PublicSupabaseConfig>;
        if (!data.url || !data.anonKey) {
          // eslint-disable-next-line no-console
          console.warn("[supabase] runtime config payload incomplete", data);
          configPromise = null;
          return null;
        }
        return { url: data.url, anonKey: data.anonKey };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[supabase] runtime config error:", error);
        configPromise = null;
        return null;
      }
    })();
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

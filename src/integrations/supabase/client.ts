import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";

type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

function normalizeSupabaseUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const getRuntimeSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.AESPACRM_SUPA_URL;
  const anonKey = process.env.AESPACRM_SUPA_ANON_KEY;

  // eslint-disable-next-line no-console
  console.log("[supabase-config] runtime check", {
    hasUrl: Boolean(url),
    hasAnonKey: Boolean(anonKey),
    urlPreview: url ? url.slice(0, 30) : null,
  });

  if (!url || !anonKey) {
    return { ok: false as const, reason: "missing_secrets", hasUrl: Boolean(url), hasAnonKey: Boolean(anonKey) };
  }

  return { ok: true as const, url, anonKey };
});

const BUILD_SUPABASE_URL = import.meta.env.VITE_AESPACRM_SUPA_URL as string | undefined;
const BUILD_SUPABASE_ANON_KEY = import.meta.env.VITE_AESPACRM_SUPA_ANON_KEY as string | undefined;
const NORMALIZED_BUILD_SUPABASE_URL = BUILD_SUPABASE_URL
  ? normalizeSupabaseUrl(BUILD_SUPABASE_URL)
  : null;
const hasBuildConfig = Boolean(NORMALIZED_BUILD_SUPABASE_URL && BUILD_SUPABASE_ANON_KEY);

let supabase: ReturnType<typeof createBrowserClient> | null = hasBuildConfig
  ? createBrowserClient(NORMALIZED_BUILD_SUPABASE_URL!, BUILD_SUPABASE_ANON_KEY!)
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
    db: { schema: "aespacrm" },
  });
}

async function fetchRuntimeConfig(): Promise<PublicSupabaseConfig | null> {
  if (hasBuildConfig) {
    return { url: NORMALIZED_BUILD_SUPABASE_URL!, anonKey: BUILD_SUPABASE_ANON_KEY! };
  }

  if (typeof window === "undefined") return null;

  if (!configPromise) {
    configPromise = (async () => {
      try {
        const res = await getRuntimeSupabaseConfig();
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.warn("[supabase] runtime config not ok:", res);
          configPromise = null;
          return null;
        }
        const normalizedUrl = normalizeSupabaseUrl(res.url);
        if (!normalizedUrl) {
          // eslint-disable-next-line no-console
          console.warn("[supabase] invalid runtime url:", res.url);
          configPromise = null;
          return null;
        }
        return { url: normalizedUrl, anonKey: res.anonKey };
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

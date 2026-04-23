import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
};

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const CONFIG_ERROR =
  "As secrets públicas do Supabase não foram encontradas no projeto. Confirme AESPACRM_SUPA_URL e AESPACRM_SUPA_ANON_KEY em Cloud → Secrets.";

function profileToUser(p: Profile | null, fallbackEmail: string, fallbackId: string): User {
  return {
    id: fallbackId,
    email: p?.email ?? fallbackEmail,
    name: p?.display_name?.trim() || (p?.email ?? fallbackEmail).split("@")[0] || "Usuário",
    avatarUrl: p?.avatar_url ?? null,
  };
}

async function fetchProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[auth] fetchProfile error:", error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

async function ensureClient() {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error(CONFIG_ERROR);
  }
  return client;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = async (client: SupabaseClient, s: Session | null) => {
    setSession(s);
    if (!s?.user) {
      setUser(null);
      return;
    }
    const profile = await fetchProfile(client, s.user.id);
    setUser(profileToUser(profile, s.user.email ?? "", s.user.id));
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const bootstrap = async () => {
      try {
        const client = await getSupabaseClient();
        if (!active) return;

        if (!client) {
          setUser(null);
          setSession(null);
          setLoading(false);
          return;
        }

        const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
          setSession(s);
          if (s?.user) {
            setTimeout(() => {
              fetchProfile(client, s.user.id).then((p) => {
                if (!active) return;
                setUser(profileToUser(p, s.user.email ?? "", s.user.id));
              });
            }, 0);
          } else {
            setUser(null);
          }
        });

        unsubscribe = () => sub.subscription.unsubscribe();

        const {
          data: { session: currentSession },
        } = await client.auth.getSession();

        if (!active) {
          unsubscribe?.();
          return;
        }

        await hydrate(client, currentSession);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] bootstrap error:", error);
        setUser(null);
        setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const client = await ensureClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const logout = async () => {
    const client = await getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    setUser(null);
    setSession(null);
  };

  const requestPasswordReset = async (email: string) => {
    const client = await ensureClient();
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    const client = await ensureClient();
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  const refreshProfile = async () => {
    if (!session?.user) return;
    const client = await getSupabaseClient();
    if (!client) return;
    const p = await fetchProfile(client, session.user.id);
    setUser(profileToUser(p, session.user.email ?? "", session.user.id));
  };

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        loading,
        login,
        logout,
        requestPasswordReset,
        updatePassword,
        refreshProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

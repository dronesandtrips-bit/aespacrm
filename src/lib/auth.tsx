import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

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

function profileToUser(p: Profile | null, fallbackEmail: string, fallbackId: string): User {
  return {
    id: fallbackId,
    email: p?.email ?? fallbackEmail,
    name: p?.display_name?.trim() || (p?.email ?? fallbackEmail).split("@")[0] || "Usuário",
    avatarUrl: p?.avatar_url ?? null,
  };
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = async (s: Session | null) => {
    setSession(s);
    if (!s?.user) {
      setUser(null);
      return;
    }
    // Defer profile fetch to avoid deadlocks inside onAuthStateChange callback
    const profile = await fetchProfile(s.user.id);
    setUser(profileToUser(profile, s.user.email ?? "", s.user.id));
  };

  useEffect(() => {
    // 1. Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer any supabase calls to avoid deadlock
      setSession(s);
      if (s?.user) {
        setTimeout(() => {
          fetchProfile(s.user.id).then((p) => {
            setUser(profileToUser(p, s.user.email ?? "", s.user.id));
          });
        }, 0);
      } else {
        setUser(null);
      }
    });

    // 2. THEN check existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      hydrate(s).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  const requestPasswordReset = async (email: string) => {
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  const refreshProfile = async () => {
    if (!session?.user) return;
    const p = await fetchProfile(session.user.id);
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

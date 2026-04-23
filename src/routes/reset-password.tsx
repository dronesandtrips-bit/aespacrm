import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let unsubscribe: (() => void) | undefined;

    const bootstrap = async () => {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const type = params.get("type");
      const errDesc = params.get("error_description");

      if (errDesc) {
        setError(decodeURIComponent(errDesc));
        return;
      }

      const client = await getSupabaseClient();
      if (!client) {
        setError("Não foi possível conectar ao Supabase deste projeto.");
        return;
      }

      const { data: sub } = client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          setReady(true);
        }
      });

      unsubscribe = () => sub.subscription.unsubscribe();

      const {
        data: { session },
      } = await client.auth.getSession();

      if (session) setReady(true);
      else if (!type) setError("Link de redefinição inválido ou expirado.");
    };

    bootstrap().catch((err) => {
      const msg = err instanceof Error ? err.message : "Erro ao validar link de redefinição";
      setError(msg);
    });

    return () => unsubscribe?.();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      toast.success("Senha atualizada com sucesso");
      await logout();
      navigate({ to: "/login" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao atualizar senha";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-background">
      <Card className="w-full max-w-md p-8 shadow-[var(--shadow-elegant)]">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-[image:var(--gradient-primary)] text-primary-foreground">
            <MessageCircle className="size-5" />
          </div>
          <span className="font-bold">ZapCRM</span>
        </div>
        <h1 className="text-2xl font-bold">Definir nova senha</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Escolha uma senha forte com pelo menos 8 caracteres.
        </p>

        {error ? (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link to="/forgot-password">Solicitar novo link</Link>
            </Button>
          </div>
        ) : !ready ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Validando link…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Atualizar senha
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

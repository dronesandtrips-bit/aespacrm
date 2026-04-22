import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@zapcrm.com");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Login realizado com sucesso");
      navigate({ to: "/dashboard" });
    } catch {
      toast.error("Falha no login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Lado visual */}
      <div className="hidden lg:flex relative overflow-hidden bg-[image:var(--gradient-hero)] text-primary-foreground p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-white/15 backdrop-blur grid place-items-center">
            <MessageCircle className="size-6" />
          </div>
          <span className="text-xl font-bold">ZapCRM</span>
        </div>
        <div className="space-y-4 max-w-md relative z-10">
          <h2 className="text-4xl font-bold leading-tight">
            Vendas no WhatsApp,<br />sem complicação.
          </h2>
          <p className="text-white/85 text-lg">
            Centralize contatos, automatize disparos e acompanhe seu pipeline em uma
            interface elegante e poderosa.
          </p>
          <ul className="space-y-2 text-white/90 text-sm pt-4">
            <li>✓ Disparos em massa com intervalos seguros</li>
            <li>✓ Pipeline Kanban arrastar-e-soltar</li>
            <li>✓ Inbox unificada com histórico completo</li>
          </ul>
        </div>
        <div className="text-xs text-white/70">© 2026 ZapCRM · Demo</div>
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -top-20 -left-20 size-72 rounded-full bg-white/10 blur-3xl" />
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md p-8 shadow-[var(--shadow-elegant)]">
          <div className="mb-8">
            <div className="lg:hidden flex items-center gap-2 mb-6">
              <div className="size-9 rounded-xl bg-[image:var(--gradient-primary)] grid place-items-center text-primary-foreground">
                <MessageCircle className="size-5" />
              </div>
              <span className="font-bold">ZapCRM</span>
            </div>
            <h1 className="text-2xl font-bold">Entrar na sua conta</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Use qualquer email para acessar a demo.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
              Entrar
            </Button>
            <p className="text-xs text-center text-muted-foreground pt-2">
              Backend mockado · conecte seu Supabase quando estiver pronto
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

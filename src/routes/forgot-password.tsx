import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
      toast.success("Se o email existir, você receberá instruções em instantes");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enviar email";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-background">
      <Card className="w-full max-w-md p-8 shadow-[var(--shadow-elegant)]">
        <div className="flex items-center gap-2 mb-6">
          <div className="size-9 rounded-xl bg-[image:var(--gradient-primary)] grid place-items-center text-primary-foreground">
            <MessageCircle className="size-5" />
          </div>
          <span className="font-bold">ZapCRM</span>
        </div>
        <h1 className="text-2xl font-bold">Recuperar senha</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          Informe o email da sua conta. Enviaremos um link para redefinir sua senha.
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              Se houver uma conta vinculada a <strong>{email}</strong>, você receberá um
              email com as instruções em alguns minutos. Verifique também a caixa de spam.
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">
                <ArrowLeft className="size-4 mr-2" /> Voltar para login
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
              Enviar link de recuperação
            </Button>
            <Link
              to="/login"
              className="block text-center text-sm text-muted-foreground hover:text-foreground pt-2"
            >
              Voltar para login
            </Link>
          </form>
        )}
      </Card>
    </div>
  );
}

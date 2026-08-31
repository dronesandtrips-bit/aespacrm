// Card de configuração da integração Bling (Propostas Comerciais).
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, Loader2, Plug, Save, Unplug } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { toast } from "sonner";

type Status = {
  hasCredentials: boolean;
  clientIdMasked: string | null;
  clientSecretMasked: string | null;
  connected: boolean;
  expiresAt: string | null;
  redirectUri?: string;
};

export function BlingIntegrationCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await authFetch("/api/public/bling/config");
      const json = await res.json();
      if (json?.ok) setStatus(json);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("bling") === "ok") toast.success("Bling conectado com sucesso");
      if (p.get("bling") === "erro") toast.error(`Falha ao conectar o Bling: ${p.get("msg") ?? ""}`);
    }
  }, []);

  const post = async (body: any) => {
    setBusy(true);
    try {
      const res = await authFetch("/api/public/bling/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "falha");
      return json;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      const json = await post({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setStatus(json);
      setClientId("");
      setClientSecret("");
      toast.success("Credenciais do Bling salvas");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  const connect = async () => {
    try {
      const json = await post({ action: "authorize" });
      if (typeof window !== "undefined") window.location.href = json.url;
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao iniciar conexão");
    }
  };

  const disconnect = async () => {
    try {
      const json = await post({ action: "disconnect" });
      setStatus(json);
      toast.success("Bling desconectado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const redirect = status?.redirectUri ?? "";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-emerald-500/10 text-emerald-600 grid place-items-center">
            <Plug className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold">Bling — Propostas Comerciais</h3>
            <p className="text-xs text-muted-foreground">
              Importa orçamentos recentes e cria contatos na categoria BLING.
            </p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="size-4 animate-spin opacity-60" />
        ) : status?.connected ? (
          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Conectado</Badge>
        ) : (
          <Badge variant="secondary">Desconectado</Badge>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
        <p className="font-medium">Passo 1 — no painel do Bling</p>
        <p className="text-muted-foreground">
          Preferências → Sistemas → API → cadastre um aplicativo e informe a URL de redirecionamento abaixo.
        </p>
        {redirect && (
          <div className="flex items-center gap-2 pt-1">
            <code className="font-mono bg-background border rounded px-2 py-1 truncate">{redirect}</code>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => {
                navigator.clipboard.writeText(redirect);
                toast.success("URL copiada");
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Client ID {status?.clientIdMasked && <span className="text-muted-foreground">({status.clientIdMasked})</span>}</Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={status?.hasCredentials ? "Deixe em branco para manter" : "Client ID do Bling"}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Client Secret {status?.clientSecretMasked && <span className="text-muted-foreground">({status.clientSecretMasked})</span>}</Label>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={status?.hasCredentials ? "Deixe em branco para manter" : "Client Secret do Bling"}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy || (!clientId.trim() && !clientSecret.trim())} className="gap-1.5">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar credenciais
        </Button>
        <Button variant="outline" onClick={connect} disabled={busy || !status?.hasCredentials} className="gap-1.5">
          <ExternalLink className="size-4" /> {status?.connected ? "Reconectar" : "Conectar ao Bling"}
        </Button>
        {status?.connected && (
          <Button variant="ghost" onClick={disconnect} disabled={busy} className="gap-1.5 text-destructive">
            <Unplug className="size-4" /> Desconectar
          </Button>
        )}
      </div>
    </Card>
  );
}

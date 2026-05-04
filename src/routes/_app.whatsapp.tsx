import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Smartphone,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Shield,
  Wifi,
  Loader2,
  AlertCircle,
  Send,
  Image as ImageIcon,
  Users,
} from "lucide-react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/whatsapp")({
  component: WhatsAppPage,
});

type StatusResp = {
  ok: boolean;
  found?: boolean;
  state?: "open" | "connecting" | "close" | "unknown";
  number?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  counts?: { messages: number | null; contacts: number | null; chats: number | null };
  reason?: string;
};

type QrResp = {
  ok: boolean;
  base64?: string | null;
  code?: string | null;
  pairingCode?: string | null;
  reason?: string;
};

function WhatsAppPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [qr, setQr] = useState<QrResp | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingQr, setLoadingQr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/public/evolution/status");
      const j: StatusResp = await r.json();
      setStatus(j);
      if (!j.ok) setError(j.reason ?? "Erro ao consultar status");
      else setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Falha de rede");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchQr = useCallback(async () => {
    setLoadingQr(true);
    try {
      const r = await fetch("/api/public/evolution/qr");
      const j: QrResp = await r.json();
      setQr(j);
      if (!j.ok) toast.error("Não foi possível gerar o QR");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao buscar QR");
    } finally {
      setLoadingQr(false);
    }
  }, []);

  // Status polling: 5s
  useEffect(() => {
    fetchStatus();
    const t = window.setInterval(fetchStatus, 5000);
    return () => window.clearInterval(t);
  }, [fetchStatus]);

  // Quando desconectado, busca QR e renova a cada 30s
  useEffect(() => {
    if (status?.state && status.state !== "open") {
      if (!qr) fetchQr();
      const t = window.setInterval(fetchQr, 30000);
      return () => window.clearInterval(t);
    }
    if (status?.state === "open") setQr(null);
  }, [status?.state, qr, fetchQr]);

  const connected = status?.state === "open";
  const connecting = status?.state === "connecting";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 max-w-[1300px]">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            Status da conexão
          </h3>
          {loadingStatus ? (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="size-3 animate-spin" /> Verificando
            </Badge>
          ) : connected ? (
            <Badge className="bg-success text-primary-foreground gap-1">
              <CheckCircle2 className="size-3" /> Conectado
            </Badge>
          ) : connecting ? (
            <Badge variant="outline" className="border-warning text-warning gap-1">
              <Loader2 className="size-3 animate-spin" /> Conectando
            </Badge>
          ) : (
            <Badge variant="outline" className="border-destructive text-destructive gap-1">
              <XCircle className="size-3" /> Desconectado
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Instância: <span className="font-mono">zapcrm</span>
          {error ? <span className="ml-2 text-destructive">· {error}</span> : null}
        </p>

        {connected ? (
          <div className="text-center py-8 space-y-3">
            {status?.profilePicUrl ? (
              <img
                src={status.profilePicUrl}
                alt={status.profileName ?? "perfil"}
                className="size-20 mx-auto rounded-full object-cover ring-2 ring-success/30"
              />
            ) : (
              <div className="size-20 mx-auto rounded-full bg-success/10 grid place-items-center">
                <Wifi className="size-10 text-success" />
              </div>
            )}
            <div>
              <p className="font-semibold">{status?.profileName ?? "Conectado"}</p>
              <p className="text-sm text-muted-foreground">
                {status?.number ? `+${status.number}` : "—"}
              </p>
            </div>
            {status?.counts ? (
              <div className="flex gap-6 justify-center text-xs text-muted-foreground pt-2">
                <div><b className="text-foreground">{status.counts.messages?.toLocaleString() ?? "—"}</b> mensagens</div>
                <div><b className="text-foreground">{status.counts.contacts?.toLocaleString() ?? "—"}</b> contatos</div>
                <div><b className="text-foreground">{status.counts.chats?.toLocaleString() ?? "—"}</b> conversas</div>
              </div>
            ) : null}
            <Separator className="my-4" />
            <SyncContactsButton />
          </div>
        ) : (
          <div className="text-center space-y-4">
            {loadingQr && !qr ? (
              <div className="size-56 mx-auto grid place-items-center bg-muted rounded-xl">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : qr?.base64 ? (
              <div className="bg-white p-4 rounded-xl shadow-inner inline-block">
                <img src={qr.base64} alt="QR Code WhatsApp" className="size-56" />
              </div>
            ) : (
              <div className="size-56 mx-auto grid place-items-center bg-muted rounded-xl text-muted-foreground text-xs gap-2 flex-col p-4">
                <AlertCircle className="size-6" />
                <span>QR indisponível</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {qr?.pairingCode
                ? <>Código de pareamento: <span className="font-mono font-semibold">{qr.pairingCode}</span></>
                : "Este QR expira em ~30 segundos"}
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={fetchQr} disabled={loadingQr} className="gap-2">
                {loadingQr ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Gerar novo QR
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <h4 className="font-semibold mb-3">Como conectar</h4>
          <ol className="space-y-3 text-sm">
            {[
              "Abra o WhatsApp no seu celular",
              "Toque em Menu (⋮) ou Configurações",
              "Selecione 'Aparelhos conectados'",
              "Toque em 'Conectar um aparelho'",
              "Aponte para o QR Code ao lado",
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5 border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <Shield className="size-5 text-warning shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Dicas de segurança</h4>
              <Separator className="my-2" />
              <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                <li>Nunca compartilhe seu QR Code</li>
                <li>Desconecte sessões antigas que não use</li>
                <li>Use intervalos seguros nos disparos</li>
                <li>Respeite as políticas do WhatsApp</li>
              </ul>
            </div>
          </div>
        </Card>

        <SendTestCard disabled={!connected} />
      </div>
    </div>
  );
}

function SendTestCard({ disabled }: { disabled: boolean }) {
  const [number, setNumber] = useState("");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [mediatype, setMediatype] = useState<"image" | "video" | "document">("image");
  const [sending, setSending] = useState(false);

  const cleanNumber = number.replace(/\D/g, "");

  async function sendText() {
    if (!cleanNumber || !text.trim()) {
      toast.error("Informe número e texto");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/public/evolution/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: cleanNumber, text: text.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
      toast.success("Mensagem enviada!");
      setText("");
    } catch (e: any) {
      toast.error("Falha ao enviar", { description: String(e?.message ?? e) });
    } finally {
      setSending(false);
    }
  }

  async function sendMedia() {
    if (!cleanNumber || !mediaUrl.trim()) {
      toast.error("Informe número e URL da mídia");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/public/evolution/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: cleanNumber,
          mediatype,
          media: mediaUrl.trim(),
          caption: caption.trim() || undefined,
          fileName: mediatype === "document" ? mediaUrl.split("/").pop() : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
      toast.success("Mídia enviada!");
      setMediaUrl("");
      setCaption("");
    } catch (e: any) {
      toast.error("Falha ao enviar mídia", { description: String(e?.message ?? e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-5">
      <h4 className="font-semibold mb-1 flex items-center gap-2">
        <Send className="size-4 text-primary" /> Teste de envio
      </h4>
      <p className="text-xs text-muted-foreground mb-4">
        {disabled
          ? "Conecte o WhatsApp acima para liberar os testes."
          : "Envie uma mensagem de teste pela instância zapcrm."}
      </p>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Número (com DDI, só dígitos)</Label>
          <Input
            placeholder="5511999999999"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={disabled || sending}
            inputMode="numeric"
            maxLength={20}
          />
        </div>

        <Tabs defaultValue="text">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="text" className="gap-1">
              <Send className="size-3" /> Texto
            </TabsTrigger>
            <TabsTrigger value="media" className="gap-1">
              <ImageIcon className="size-3" /> Mídia
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-3 pt-3">
            <Textarea
              placeholder="Mensagem de teste..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disabled || sending}
              rows={3}
              maxLength={4096}
            />
            <Button
              onClick={sendText}
              disabled={disabled || sending || !cleanNumber || !text.trim()}
              className="w-full gap-2"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar texto
            </Button>
          </TabsContent>

          <TabsContent value="media" className="space-y-3 pt-3">
            <div className="grid grid-cols-3 gap-1">
              {(["image", "video", "document"] as const).map((t) => (
                <Button
                  key={t}
                  variant={mediatype === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMediatype(t)}
                  disabled={disabled || sending}
                  className="text-xs capitalize"
                >
                  {t === "image" ? "Imagem" : t === "video" ? "Vídeo" : "Documento"}
                </Button>
              ))}
            </div>
            <Input
              placeholder="https://exemplo.com/arquivo.jpg"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              disabled={disabled || sending}
            />
            <Input
              placeholder="Legenda (opcional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={disabled || sending}
              maxLength={1024}
            />
            <Button
              onClick={sendMedia}
              disabled={disabled || sending || !cleanNumber || !mediaUrl.trim()}
              className="w-full gap-2"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              Enviar mídia
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  );
}

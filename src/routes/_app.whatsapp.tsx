import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/whatsapp")({
  component: WhatsAppPage,
});

// SVG QR fake (decorativo)
function FakeQR() {
  // gera matriz pseudo-aleatória estável
  const cells: boolean[][] = Array.from({ length: 25 }, (_, r) =>
    Array.from({ length: 25 }, (_, c) => ((r * 31 + c * 17 + 7) % 5) < 2),
  );
  return (
    <div className="bg-white p-4 rounded-xl shadow-inner inline-block">
      <svg viewBox="0 0 25 25" className="size-56">
        {cells.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#0f172a" /> : null,
          ),
        )}
        {/* Quadradinhos de canto */}
        {[
          [0, 0],
          [18, 0],
          [0, 18],
        ].map(([x, y], i) => (
          <g key={i}>
            <rect x={x} y={y} width="7" height="7" fill="#0f172a" />
            <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
            <rect x={x + 2} y={y + 2} width="3" height="3" fill="#0f172a" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function WhatsAppPage() {
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrKey, setQrKey] = useState(0);

  // Conta regressiva fake (renova QR a cada 30s)
  useEffect(() => {
    if (connected) return;
    const t = window.setInterval(() => setQrKey((k) => k + 1), 30000);
    return () => window.clearInterval(t);
  }, [connected]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setQrKey((k) => k + 1);
      setRefreshing(false);
      toast.success("Novo QR Code gerado");
    }, 800);
  };

  const handleSimulateConnect = () => {
    setConnected(true);
    toast.success("WhatsApp conectado!");
  };

  const handleDisconnect = () => {
    setConnected(false);
    toast("WhatsApp desconectado");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 max-w-[1300px]">
      {/* QR / Status */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            Status da conexão
          </h3>
          {connected ? (
            <Badge className="bg-success text-primary-foreground gap-1">
              <CheckCircle2 className="size-3" /> Conectado
            </Badge>
          ) : (
            <Badge variant="outline" className="border-destructive text-destructive gap-1">
              <XCircle className="size-3" /> Desconectado
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          {connected
            ? "Sua sessão está ativa e pronta para enviar mensagens"
            : "Escaneie o QR Code com seu WhatsApp para conectar"}
        </p>

        {connected ? (
          <div className="text-center py-8 space-y-3">
            <div className="size-20 mx-auto rounded-full bg-success/10 grid place-items-center">
              <Wifi className="size-10 text-success" />
            </div>
            <div>
              <p className="font-semibold">+55 11 99999-0000</p>
              <p className="text-xs text-muted-foreground">
                Última conexão: agora mesmo
              </p>
            </div>
            <Button variant="outline" onClick={handleDisconnect}>
              Desconectar
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <div key={qrKey} className="animate-in fade-in duration-300">
              <FakeQR />
            </div>
            <p className="text-xs text-muted-foreground">
              Este QR expira em 30 segundos
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="gap-2">
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Gerar novo QR
              </Button>
              <Button onClick={handleSimulateConnect} className="gap-2">
                <CheckCircle2 className="size-4" /> Simular conexão
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Guia + Segurança */}
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
      </div>
    </div>
  );
}

// Detector — laboratório para testar o reconhecimento de agendamentos
// nas mensagens do Robô, sem precisar mandar WhatsApp de verdade.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bot, CalendarCheck, Loader2, Send, XCircle } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";

export const Route = createFileRoute("/_app/detector")({
  component: DetectorPage,
  head: () => ({
    meta: [
      { title: "Detector de agendamentos | Aespa CRM" },
      {
        name: "description",
        content:
          "Teste em tempo real como o CRM interpreta as mensagens do Robô e transforma horários combinados em compromissos.",
      },
      { property: "og:title", content: "Detector de agendamentos | Aespa CRM" },
      {
        property: "og:description",
        content: "Simule mensagens e veja o horário calculado e o evento criado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DEFAULT_PHONE = "5554991495959";

const EXAMPLES = [
  "Perfeito! Confirmado para quarta às 14h, te espero.",
  "Ficou marcado amanhã as 9 horas",
  "Agendei para 20/08 às 15:30",
  "Marcado dia 25 de agosto às 8h",
  "Bom dia! Posso te ajudar em algo?",
];

type Result = {
  at: string;
  text: string;
  detected: boolean;
  startISO?: string;
  matched?: string;
  duplicate?: boolean;
  created?: boolean;
  createError?: string | null;
  reason?: string;
  enabled?: boolean;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetectorPage() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [name, setName] = useState("Cliente Teste");
  const [create, setCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const run = async () => {
    const value = text.trim();
    if (!value) return;
    setLoading(true);
    try {
      const res = await authFetch("/api/public/calendar/detect-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value, phone, name, create }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);

      setResults((prev) => [
        {
          at: new Date().toISOString(),
          text: value,
          detected: Boolean(json.detected),
          startISO: json.startISO,
          matched: json.matched,
          duplicate: json.duplicate,
          created: json.created,
          createError: json.createError,
          reason: json.reason,
          enabled: json.enabled,
        },
        ...prev,
      ]);

      if (json.detected) {
        if (json.created) toast.success("Detectado e evento criado no Google Agenda");
        else if (json.duplicate) toast.info("Detectado, mas já existe compromisso próximo");
        else toast.success("Horário detectado (simulação)");
      } else {
        toast.info("Nada detectado nessa mensagem");
      }
    } catch (err: any) {
      toast.error(`Falha no teste: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bot className="h-6 w-6 text-primary" />
          Detector de agendamentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Escreva uma mensagem como o Robô escreveria e veja o que o CRM entende: horário
          calculado, duplicidade e se o compromisso seria criado.
        </p>
      </header>

      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="msg">Mensagem enviada no chat</Label>
          <Textarea
            id="msg"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
            }}
            placeholder="Ex.: Confirmado para quinta às 16h"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setText(ex)}
              >
                {ex.length > 38 ? `${ex.slice(0, 38)}…` : ex}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone do contato</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Nome do contato</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="create" className="text-sm">
              Criar o compromisso de verdade
            </Label>
            <p className="text-xs text-muted-foreground">
              Desligado = só simula. Ligado = cria o evento “(a confirmar)” e te avisa no
              WhatsApp.
            </p>
          </div>
          <Switch id="create" checked={create} onCheckedChange={setCreate} />
        </div>

        <Button onClick={run} disabled={loading || !text.trim()} className="w-full sm:w-auto">
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Testar detector
        </Button>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Resultados ({results.length})
        </h2>
        {results.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum teste ainda. Envie uma mensagem acima.
          </Card>
        ) : (
          results.map((r, i) => (
            <Card key={`${r.at}-${i}`} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">{r.text}</p>
                {r.detected ? (
                  <Badge className="shrink-0 bg-emerald-600 hover:bg-emerald-600">
                    Detectado
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    Sem detecção
                  </Badge>
                )}
              </div>

              {r.detected ? (
                <div className="space-y-1 text-sm">
                  <p className="flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4 text-primary" />
                    <span className="font-medium">{r.startISO ? fmt(r.startISO) : "—"}</span>
                    <span className="text-xs text-muted-foreground">
                      (trecho: {r.matched})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.created
                      ? "Evento criado no Google Agenda como “(a confirmar)”."
                      : r.duplicate
                        ? "Não criaria: já existe compromisso deste contato em ±30 min."
                        : "Simulação — nada foi criado."}
                  </p>
                  {r.createError ? (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="h-3 w-3" /> {r.createError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{r.reason}</p>
              )}

              {r.enabled === false ? (
                <p className="text-xs text-amber-600">
                  Atenção: o detector está desligado (ZAPCRM_AUTO_BOOK=off) — em produção nada
                  seria criado.
                </p>
              ) : null}
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

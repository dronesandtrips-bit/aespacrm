// Dashboard executivo de Sequências
// Métricas: envios por dia, taxa de resposta, funil, top sequências
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  Send,
  MessageSquareReply,
  CheckCheck,
  Pause,
  Play,
  TrendingUp,
  Loader2,
  Activity,
  XCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { sequencesDb, type Sequence } from "@/lib/db";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sequencias-dashboard")({
  component: SequencesDashboard,
});

type SendLog = {
  sent_at: string;
  status: "sent" | "failed";
  contact_sequence_id: string;
  contact_sequences: { sequence_id: string } | null;
};

type ContactSeq = {
  status: "active" | "paused" | "completed" | "cancelled";
  pause_reason: string | null;
  sequence_id: string;
  started_at: string;
};

type Period = 7 | 14 | 30;

function SequencesDashboard() {
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);
  const [sends, setSends] = useState<SendLog[]>([]);
  const [contactSeqs, setContactSeqs] = useState<ContactSeq[]>([]);
  const [seqs, setSeqs] = useState<Sequence[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const sb = await getSupabaseClient();
        if (!sb) throw new Error("Supabase indisponível");
        const since = new Date(Date.now() - period * 86400000).toISOString();

        const [sendsRes, csRes, seqList] = await Promise.all([
          sb
            .schema("aespacrm" as any)
            .from("crm_sequence_send_log")
            .select(
              `sent_at, status, contact_sequence_id,
               contact_sequences:crm_contact_sequences!inner ( sequence_id )`,
            )
            .gte("sent_at", since)
            .limit(2000),
          sb
            .schema("aespacrm" as any)
            .from("crm_contact_sequences")
            .select("status, pause_reason, sequence_id, started_at")
            .limit(2000),
          sequencesDb.list(),
        ]);

        if (sendsRes.error) throw sendsRes.error;
        if (csRes.error) throw csRes.error;

        setSends((sendsRes.data ?? []) as any);
        setContactSeqs((csRes.data ?? []) as any);
        setSeqs(seqList);
      } catch (e: any) {
        toast.error(`Erro ao carregar dashboard: ${e.message ?? e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  // ==================== KPIs ====================
  const totalSent = sends.filter((s) => s.status === "sent").length;
  const totalFailed = sends.filter((s) => s.status === "failed").length;
  const active = contactSeqs.filter((c) => c.status === "active").length;
  const paused = contactSeqs.filter((c) => c.status === "paused").length;
  const completed = contactSeqs.filter((c) => c.status === "completed").length;
  const repliedPaused = contactSeqs.filter(
    (c) => c.status === "paused" && c.pause_reason === "inbound_reply",
  ).length;
  const totalContacts = contactSeqs.length;
  const replyRate =
    totalContacts > 0 ? Math.round((repliedPaused / totalContacts) * 100) : 0;
  const completionRate =
    totalContacts > 0 ? Math.round((completed / totalContacts) * 100) : 0;

  // ==================== Envios por dia ====================
  const sendsByDay = useMemo(() => {
    const buckets: Record<string, { day: string; enviadas: number; falhas: number }> = {};
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = {
        day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        enviadas: 0,
        falhas: 0,
      };
    }
    sends.forEach((s) => {
      const key = s.sent_at.slice(0, 10);
      const b = buckets[key];
      if (!b) return;
      if (s.status === "sent") b.enviadas += 1;
      else b.falhas += 1;
    });
    return Object.values(buckets);
  }, [sends, period]);

  // ==================== Top sequências por engajamento ====================
  const topSeqs = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; iniciados: number; respondidos: number; concluidos: number }
    >();
    seqs.forEach((s) =>
      map.set(s.id, {
        id: s.id,
        name: s.name,
        iniciados: 0,
        respondidos: 0,
        concluidos: 0,
      }),
    );
    contactSeqs.forEach((c) => {
      const row = map.get(c.sequence_id);
      if (!row) return;
      row.iniciados += 1;
      if (c.status === "completed") row.concluidos += 1;
      if (c.status === "paused" && c.pause_reason === "inbound_reply")
        row.respondidos += 1;
    });
    return Array.from(map.values())
      .filter((r) => r.iniciados > 0)
      .sort((a, b) => b.iniciados - a.iniciados)
      .slice(0, 6);
  }, [seqs, contactSeqs]);

  // ==================== Funil ====================
  const funnel = [
    { stage: "Iniciados", count: totalContacts },
    { stage: "Em andamento", count: active },
    { stage: "Concluídos", count: completed },
    { stage: "Responderam", count: repliedPaused },
  ];

  if (loading) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Loader2 className="size-6 mx-auto mb-2 animate-spin opacity-60" />
        <p className="text-sm">Carregando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" /> Dashboard de Sequências
          </h1>
          <p className="text-sm text-muted-foreground">
            Métricas de envios, engajamento e conclusão.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as Period)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="14">Últimos 14 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link to="/logs">
              <Activity className="size-4 mr-1" /> Ver logs
            </Link>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          icon={<Send className="size-4" />}
          label="Mensagens enviadas"
          value={totalSent}
          tint="bg-primary/10 text-primary"
        />
        <Kpi
          icon={<XCircle className="size-4" />}
          label="Falhas"
          value={totalFailed}
          tint="bg-destructive/10 text-destructive"
        />
        <Kpi
          icon={<Play className="size-4" />}
          label="Ativos"
          value={active}
          tint="bg-emerald-500/10 text-emerald-600"
        />
        <Kpi
          icon={<Pause className="size-4" />}
          label="Pausados"
          value={paused}
          tint="bg-amber-500/10 text-amber-600"
        />
        <Kpi
          icon={<MessageSquareReply className="size-4" />}
          label="Taxa de resposta"
          value={`${replyRate}%`}
          hint={`${repliedPaused} respondeu`}
          tint="bg-accent/10 text-accent"
        />
        <Kpi
          icon={<CheckCheck className="size-4" />}
          label="Conclusão"
          value={`${completionRate}%`}
          hint={`${completed} concluídos`}
          tint="bg-primary/10 text-primary"
        />
      </div>

      {/* Envios por dia */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Envios por dia</h3>
            <p className="text-xs text-muted-foreground">
              Enviadas com sucesso vs falhas — últimos {period} dias
            </p>
          </div>
          <Badge variant="secondary">{totalSent + totalFailed} total</Badge>
        </div>
        <div className="h-[280px]">
          {totalSent + totalFailed === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Nenhum envio no período
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sendsByDay}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.69 0.17 152)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.69 0.17 152)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.2 25)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="oklch(0.65 0.2 25)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 230)" />
                <XAxis dataKey="day" stroke="oklch(0.5 0.03 230)" fontSize={12} />
                <YAxis stroke="oklch(0.5 0.03 230)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "white",
                    border: "1px solid oklch(0.92 0.01 230)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="enviadas"
                  stroke="oklch(0.55 0.16 152)"
                  fill="url(#gSent)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="falhas"
                  stroke="oklch(0.6 0.2 25)"
                  fill="url(#gFail)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Funil + Top sequências */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-1">
          <h3 className="font-semibold mb-1">Funil de engajamento</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Iniciados → ativos → concluídos → responderam
          </p>
          <div className="h-[280px]">
            {totalContacts === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Nenhum contato em sequência
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 230)" />
                  <XAxis type="number" stroke="oklch(0.5 0.03 230)" fontSize={12} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    stroke="oklch(0.5 0.03 230)"
                    fontSize={12}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid oklch(0.92 0.01 230)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="oklch(0.69 0.17 152)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Top sequências</h3>
              <p className="text-xs text-muted-foreground">
                Por número de contatos iniciados
              </p>
            </div>
            <TrendingUp className="size-4 text-muted-foreground" />
          </div>
          {topSeqs.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
              Nenhuma sequência em uso ainda
            </div>
          ) : (
            <ul className="space-y-3">
              {topSeqs.map((s) => {
                const replyPct =
                  s.iniciados > 0 ? Math.round((s.respondidos / s.iniciados) * 100) : 0;
                const compPct =
                  s.iniciados > 0 ? Math.round((s.concluidos / s.iniciados) * 100) : 0;
                return (
                  <li key={s.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[10px]">
                          {s.iniciados} iniciados
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <MessageSquareReply className="size-3" />
                          {replyPct}%
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <CheckCheck className="size-3" />
                          {compPct}%
                        </Badge>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${compPct}%` }}
                        title={`${s.concluidos} concluídos`}
                      />
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${replyPct}%` }}
                        title={`${s.respondidos} responderam`}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {s.concluidos} concluídos · {s.respondidos} responderam
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tint: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold mt-0.5 tracking-tight">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${tint}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

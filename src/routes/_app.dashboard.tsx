import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Send,
  TrendingUp,
  Inbox as InboxIcon,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import {
  contactsDb,
  categoriesDb,
  pipelineDb,
  bulkSendsDb,
  type Contact,
  type Category,
  type PipelineStage,
  type PipelinePlacement,
  type BulkSend,
} from "@/lib/db";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
  positive = true,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  tint: string;
}) {
  return (
    <Card className="p-5 hover:shadow-[var(--shadow-elegant)] transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold mt-1 tracking-tight">{value}</p>
        </div>
        <div className={`size-11 rounded-xl grid place-items-center ${tint}`}>
          <Icon className="size-5" />
        </div>
      </div>
      {delta && (
        <div className="flex items-center gap-1 mt-3 text-xs">
          {positive ? (
            <ArrowUpRight className="size-3.5 text-success" />
          ) : (
            <ArrowDownRight className="size-3.5 text-destructive" />
          )}
          <span className={positive ? "text-success font-medium" : "text-destructive font-medium"}>
            {delta}
          </span>
          <span className="text-muted-foreground">vs período anterior</span>
        </div>
      )}
    </Card>
  );
}

type DayBucket = { day: string; enviadas: number; respondidas: number };

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [placements, setPlacements] = useState<PipelinePlacement[]>([]);
  const [bulks, setBulks] = useState<BulkSend[]>([]);
  const [messagesData, setMessagesData] = useState<DayBucket[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [responseRate, setResponseRate] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [cs, cats, st, pl, bk, c] = await Promise.all([
          contactsDb.list(),
          categoriesDb.list(),
          pipelineDb.listStages(),
          pipelineDb.listPlacements(),
          bulkSendsDb.list(),
          getSupabaseClient(),
        ]);
        setContacts(cs);
        setCategories(cats);
        setStages(st);
        setPlacements(pl);
        setBulks(bk);

        // Mensagens últimos 7 dias
        if (c) {
          const since = new Date(Date.now() - 7 * 86400000).toISOString();
          const { data } = await c
            .from("crm_messages")
            .select("from_me,at")
            .gte("at", since);

          const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
          const buckets: Record<string, DayBucket> = {};
          for (let i = 6; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            const key = d.toISOString().slice(0, 10);
            buckets[key] = { day: dayLabels[d.getDay()], enviadas: 0, respondidas: 0 };
          }
          let today = 0;
          let sent = 0;
          let received = 0;
          const todayKey = new Date().toISOString().slice(0, 10);
          (data ?? []).forEach((row: any) => {
            const key = row.at.slice(0, 10);
            const b = buckets[key];
            if (b) {
              if (row.from_me) b.enviadas += 1;
              else b.respondidas += 1;
            }
            if (key === todayKey) today += 1;
            if (row.from_me) sent += 1;
            else received += 1;
          });
          setMessagesData(Object.values(buckets));
          setTodayCount(today);
          setResponseRate(sent > 0 ? Math.round((received / sent) * 100) : 0);
        }
      } catch (e: any) {
        toast.error(`Erro ao carregar dashboard: ${e.message ?? e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const byCategory = categories.map((cat) => ({
    name: cat.name,
    value: contacts.filter((c) => c.categoryId === cat.id).length,
    color: cat.color,
  })).filter((x) => x.value > 0);

  const funnelData = stages.map((s) => ({
    stage: s.name,
    count: placements.filter((p) => p.stageId === s.id).length,
  }));

  const inPipeline = placements.length;

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
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          icon={Users}
          label="Total de contatos"
          value={contacts.length.toString()}
          tint="bg-primary/10 text-primary"
        />
        <Kpi
          icon={Send}
          label="Mensagens hoje"
          value={todayCount.toString()}
          tint="bg-accent/10 text-accent"
        />
        <Kpi
          icon={TrendingUp}
          label="Taxa de resposta (7d)"
          value={`${responseRate}%`}
          tint="bg-warning/10 text-warning"
        />
        <Kpi
          icon={InboxIcon}
          label="Em pipeline"
          value={inPipeline.toString()}
          tint="bg-destructive/10 text-destructive"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Mensagens — últimos 7 dias</h3>
              <p className="text-xs text-muted-foreground">Enviadas vs recebidas</p>
            </div>
            <Badge variant="secondary">Semana atual</Badge>
          </div>
          <div className="h-[260px]">
            {messagesData.every((d) => d.enviadas === 0 && d.respondidas === 0) ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Nenhuma mensagem nos últimos 7 dias
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={messagesData}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.69 0.17 152)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="oklch(0.69 0.17 152)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.7 0.16 240)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="oklch(0.7 0.16 240)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 230)" />
                  <XAxis dataKey="day" stroke="oklch(0.5 0.03 230)" fontSize={12} />
                  <YAxis stroke="oklch(0.5 0.03 230)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid oklch(0.92 0.01 230)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="enviadas" stroke="oklch(0.55 0.16 152)" fill="url(#g1)" strokeWidth={2} />
                  <Area type="monotone" dataKey="respondidas" stroke="oklch(0.6 0.15 240)" fill="url(#g2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-1">Contatos por categoria</h3>
          <p className="text-xs text-muted-foreground mb-2">Distribuição</p>
          <div className="h-[260px]">
            {byCategory.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Sem categorias com contatos
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {byCategory.map((c, i) => (
                      <Cell key={i} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Funnel + recent */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold mb-1">Funil de vendas</h3>
          <p className="text-xs text-muted-foreground mb-3">Quantidade de contatos por etapa</p>
          <div className="h-[240px]">
            {funnelData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Configure etapas em Configurações → Pipeline
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 230)" />
                  <XAxis type="number" stroke="oklch(0.5 0.03 230)" fontSize={12} />
                  <YAxis type="category" dataKey="stage" stroke="oklch(0.5 0.03 230)" fontSize={12} width={90} />
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

        <Card className="p-5">
          <h3 className="font-semibold mb-3">Disparos recentes</h3>
          {bulks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum disparo ainda</p>
          ) : (
            <ul className="space-y-3">
              {bulks.slice(0, 5).map((b) => {
                const pct = b.totalContacts > 0 ? Math.round((b.sentCount / b.totalContacts) * 100) : 0;
                return (
                  <li key={b.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{b.name}</p>
                      <span className="text-xs text-muted-foreground shrink-0">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {b.sentCount}/{b.totalContacts} · {new Date(b.createdAt).toLocaleDateString("pt-BR")}
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

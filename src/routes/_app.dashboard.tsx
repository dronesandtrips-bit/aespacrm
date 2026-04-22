import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Send,
  TrendingUp,
  Inbox as InboxIcon,
  ArrowUpRight,
  ArrowDownRight,
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
import { db } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

const messagesData = [
  { day: "Seg", enviadas: 120, respondidas: 38 },
  { day: "Ter", enviadas: 180, respondidas: 64 },
  { day: "Qua", enviadas: 240, respondidas: 92 },
  { day: "Qui", enviadas: 210, respondidas: 84 },
  { day: "Sex", enviadas: 320, respondidas: 145 },
  { day: "Sáb", enviadas: 160, respondidas: 60 },
  { day: "Dom", enviadas: 90, respondidas: 30 },
];

const funnelData = [
  { stage: "Novo Lead", count: 240 },
  { stage: "Em Contato", count: 168 },
  { stage: "Proposta", count: 92 },
  { stage: "Negociação", count: 54 },
  { stage: "Fechado", count: 28 },
];

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
  delta: string;
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
      <div className="flex items-center gap-1 mt-3 text-xs">
        {positive ? (
          <ArrowUpRight className="size-3.5 text-success" />
        ) : (
          <ArrowDownRight className="size-3.5 text-destructive" />
        )}
        <span className={positive ? "text-success font-medium" : "text-destructive font-medium"}>
          {delta}
        </span>
        <span className="text-muted-foreground">vs semana anterior</span>
      </div>
    </Card>
  );
}

function Dashboard() {
  const contacts = db.listContacts();
  const categories = db.listCategories();

  const byCategory = categories.map((cat) => ({
    name: cat.name,
    value: contacts.filter((c) => c.categoryId === cat.id).length || 1,
    color: cat.color,
  }));

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          icon={Users}
          label="Total de contatos"
          value={contacts.length.toString()}
          delta="+12%"
          tint="bg-primary/10 text-primary"
        />
        <Kpi
          icon={Send}
          label="Mensagens hoje"
          value="1.320"
          delta="+24%"
          tint="bg-accent/10 text-accent"
        />
        <Kpi
          icon={TrendingUp}
          label="Taxa de resposta"
          value="42%"
          delta="+3.1%"
          tint="bg-warning/10 text-warning"
        />
        <Kpi
          icon={InboxIcon}
          label="Em pipeline"
          value="582"
          delta="-1.4%"
          positive={false}
          tint="bg-destructive/10 text-destructive"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Mensagens — últimos 7 dias</h3>
              <p className="text-xs text-muted-foreground">Enviadas vs respondidas</p>
            </div>
            <Badge variant="secondary">Semana atual</Badge>
          </div>
          <div className="h-[260px]">
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
                <Area
                  type="monotone"
                  dataKey="enviadas"
                  stroke="oklch(0.55 0.16 152)"
                  fill="url(#g1)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="respondidas"
                  stroke="oklch(0.6 0.15 240)"
                  fill="url(#g2)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-1">Contatos por categoria</h3>
          <p className="text-xs text-muted-foreground mb-2">Distribuição</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {byCategory.map((c, i) => (
                    <Cell key={i} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Funnel + recent */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold mb-1">Funil de vendas</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Quantidade de contatos por etapa
          </p>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 230)" />
                <XAxis type="number" stroke="oklch(0.5 0.03 230)" fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="stage"
                  stroke="oklch(0.5 0.03 230)"
                  fontSize={12}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    background: "white",
                    border: "1px solid oklch(0.92 0.01 230)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="oklch(0.69 0.17 152)"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3">Atividades recentes</h3>
          <ul className="space-y-3">
            {contacts.slice(0, 5).map((c) => {
              const cat = categories.find((k) => k.id === c.categoryId);
              return (
                <li key={c.id} className="flex items-center gap-3">
                  <div
                    className="size-9 rounded-full grid place-items-center text-white text-sm font-semibold"
                    style={{ backgroundColor: cat?.color ?? "var(--muted)" }}
                  >
                    {c.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.phone}</p>
                  </div>
                  {cat && (
                    <Badge variant="outline" style={{ borderColor: cat.color, color: cat.color }}>
                      {cat.name}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

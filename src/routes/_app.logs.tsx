// Tela de monitoramento de logs de Sequências
// - Envios recentes (crm_sequence_send_log)
// - Contatos em sequência (crm_contact_sequences) — active/paused/completed
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Pause,
  Play,
  CheckCheck,
  Ban,
  MessageSquareReply,
} from "lucide-react";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { sequencesDb, type Sequence } from "@/lib/db";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_app/logs")({
  component: LogsPage,
});

type SendLogRow = {
  id: string;
  sent_at: string;
  status: "sent" | "failed";
  error: string | null;
  step_order: number;
  message: string;
  contact_sequence_id: string;
  contact_sequences: {
    id: string;
    sequence_id: string;
    contact_id: string;
    crm_contacts: { name: string; phone: string } | null;
    crm_sequences: { name: string } | null;
  } | null;
};

type ContactSeqRow = {
  id: string;
  status: "active" | "paused" | "completed" | "cancelled";
  current_step: number;
  next_send_at: string | null;
  started_at: string;
  paused_at: string | null;
  pause_reason: string | null;
  sequence_id: string;
  contact_id: string;
  crm_contacts: { name: string; phone: string } | null;
  crm_sequences: { name: string } | null;
};

function fmtRel(dt: string | null) {
  if (!dt) return "—";
  try {
    return formatDistanceToNow(new Date(dt), { addSuffix: true, locale: ptBR });
  } catch {
    return dt;
  }
}

function LogsPage() {
  const [tab, setTab] = useState<"sends" | "contacts">("sends");
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [seqFilter, setSeqFilter] = useState<string>("all");

  useEffect(() => {
    sequencesDb.list().then(setSeqs).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="size-6 text-primary" /> Logs de Sequências
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitore envios automáticos e contatos em sequência.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={seqFilter} onValueChange={setSeqFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Todas as sequências" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as sequências</SelectItem>
              {seqs.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="sends">Envios recentes</TabsTrigger>
          <TabsTrigger value="contacts">Contatos em sequência</TabsTrigger>
        </TabsList>
        <TabsContent value="sends" className="mt-4">
          <SendsTab sequenceFilter={seqFilter} />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <ContactsTab sequenceFilter={seqFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================== Envios ==============================

function SendsTab({ sequenceFilter }: { sequenceFilter: string }) {
  const [rows, setRows] = useState<SendLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "failed">("all");
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) throw new Error("Supabase indisponível");
      const { data, error } = await sb
        .schema("aespacrm" as any)
        .from("crm_sequence_send_log")
        .select(
          `id, sent_at, status, error, step_order, message, contact_sequence_id,
           contact_sequences:crm_contact_sequences!inner (
             id, sequence_id, contact_id,
             crm_contacts ( name, phone ),
             crm_sequences ( name )
           )`,
        )
        .order("sent_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sequenceFilter !== "all" && r.contact_sequences?.sequence_id !== sequenceFilter)
        return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const c = r.contact_sequences?.crm_contacts;
        if (
          !c?.name?.toLowerCase().includes(s) &&
          !c?.phone?.toLowerCase().includes(s) &&
          !r.message.toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [rows, statusFilter, sequenceFilter, search]);

  const sentCount = rows.filter((r) => r.status === "sent").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total" value={rows.length} icon={<Activity className="size-4" />} />
        <StatCard
          label="Enviadas"
          value={sentCount}
          icon={<CheckCircle2 className="size-4 text-emerald-500" />}
        />
        <StatCard
          label="Falhas"
          value={failedCount}
          icon={<XCircle className="size-4 text-destructive" />}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Buscar por nome, telefone ou mensagem…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="sent">Enviadas</SelectItem>
            <SelectItem value="failed">Falhas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Activity className="size-10 mx-auto opacity-30 mb-3" />
          <p>Nenhum envio registrado ainda.</p>
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((r) => {
            const c = r.contact_sequences?.crm_contacts;
            const seqName = r.contact_sequences?.crm_sequences?.name ?? "—";
            return (
              <div key={r.id} className="p-3 flex items-start gap-3">
                <div className="mt-0.5">
                  {r.status === "sent" ? (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  ) : (
                    <XCircle className="size-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c?.name ?? "Contato removido"}</span>
                    {c?.phone && (
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {seqName}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Passo {r.step_order + 1}
                    </Badge>
                  </div>
                  <p className="text-sm mt-1 line-clamp-2 break-words">{r.message}</p>
                  {r.error && (
                    <p className="text-xs text-destructive mt-1 break-words">⚠ {r.error}</p>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground whitespace-nowrap pt-0.5">
                  {fmtRel(r.sent_at)}
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ============================== Contatos em sequência ==============================

function ContactsTab({ sequenceFilter }: { sequenceFilter: string }) {
  const [rows, setRows] = useState<ContactSeqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "paused" | "completed" | "cancelled"
  >("all");
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const sb = await getSupabaseClient();
      if (!sb) throw new Error("Supabase indisponível");
      const { data, error } = await sb
        .schema("aespacrm" as any)
        .from("crm_contact_sequences")
        .select(
          `id, status, current_step, next_send_at, started_at, paused_at, pause_reason,
           sequence_id, contact_id,
           crm_contacts ( name, phone ),
           crm_sequences ( name )`,
        )
        .order("started_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const resume = async (id: string) => {
    try {
      const sb = await getSupabaseClient();
      if (!sb) throw new Error("Supabase indisponível");
      const { error } = await sb
        .schema("aespacrm" as any)
        .from("crm_contact_sequences")
        .update({
          status: "active",
          paused_at: null,
          pause_reason: null,
          next_send_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("Sequência retomada");
      reload();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const pause = async (id: string) => {
    try {
      const sb = await getSupabaseClient();
      if (!sb) throw new Error("Supabase indisponível");
      const { error } = await sb
        .schema("aespacrm" as any)
        .from("crm_contact_sequences")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          pause_reason: "manual",
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("Sequência pausada");
      reload();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sequenceFilter !== "all" && r.sequence_id !== sequenceFilter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (
          !r.crm_contacts?.name?.toLowerCase().includes(s) &&
          !r.crm_contacts?.phone?.toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [rows, statusFilter, sequenceFilter, search]);

  const counts = useMemo(() => {
    return {
      active: rows.filter((r) => r.status === "active").length,
      paused: rows.filter((r) => r.status === "paused").length,
      completed: rows.filter((r) => r.status === "completed").length,
    };
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={rows.length} icon={<Activity className="size-4" />} />
        <StatCard
          label="Ativos"
          value={counts.active}
          icon={<Play className="size-4 text-emerald-500" />}
        />
        <StatCard
          label="Pausados"
          value={counts.paused}
          icon={<Pause className="size-4 text-amber-500" />}
        />
        <StatCard
          label="Concluídos"
          value={counts.completed}
          icon={<CheckCheck className="size-4 text-primary" />}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="paused">Pausados</SelectItem>
            <SelectItem value="completed">Concluídos</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Activity className="size-10 mx-auto opacity-30 mb-3" />
          <p>Nenhum contato em sequência ainda.</p>
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((r) => (
            <div key={r.id} className="p-3 flex items-start gap-3">
              <StatusIcon status={r.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {r.crm_contacts?.name ?? "Contato removido"}
                  </span>
                  {r.crm_contacts?.phone && (
                    <span className="text-xs text-muted-foreground">
                      {r.crm_contacts.phone}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {r.crm_sequences?.name ?? "—"}
                  </Badge>
                  <StatusBadge status={r.status} />
                  <Badge variant="secondary" className="text-[10px]">
                    Passo {r.current_step + 1}
                  </Badge>
                  {r.pause_reason === "inbound_reply" && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <MessageSquareReply className="size-3" /> respondeu
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-3">
                  <span>Iniciada {fmtRel(r.started_at)}</span>
                  {r.status === "active" && r.next_send_at && (
                    <span>Próximo envio {fmtRel(r.next_send_at)}</span>
                  )}
                  {r.status === "paused" && r.paused_at && (
                    <span>Pausada {fmtRel(r.paused_at)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {r.status === "paused" && (
                  <Button size="sm" variant="outline" onClick={() => resume(r.id)}>
                    <Play className="size-3.5 mr-1" /> Retomar
                  </Button>
                )}
                {r.status === "active" && (
                  <Button size="sm" variant="outline" onClick={() => pause(r.id)}>
                    <Pause className="size-3.5 mr-1" /> Pausar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ============================== UI helpers ==============================

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}

function StatusIcon({ status }: { status: ContactSeqRow["status"] }) {
  const cls = "size-5 mt-0.5";
  if (status === "active") return <Play className={`${cls} text-emerald-500`} />;
  if (status === "paused") return <Pause className={`${cls} text-amber-500`} />;
  if (status === "completed") return <CheckCheck className={`${cls} text-primary`} />;
  return <Ban className={`${cls} text-muted-foreground`} />;
}

function StatusBadge({ status }: { status: ContactSeqRow["status"] }) {
  const map = {
    active: { label: "ativa", variant: "default" as const },
    paused: { label: "pausada", variant: "secondary" as const },
    completed: { label: "concluída", variant: "outline" as const },
    cancelled: { label: "cancelada", variant: "outline" as const },
  };
  const { label, variant } = map[status];
  return (
    <Badge variant={variant} className="text-[10px]">
      {label}
    </Badge>
  );
}

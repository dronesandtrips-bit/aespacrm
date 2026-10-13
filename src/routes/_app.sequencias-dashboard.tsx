import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Eye, Loader2, RefreshCw, Search, XCircle, Users, MessageSquareReply } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useSequenceMonitor } from "@/hooks/use-sequence-monitor";
import { canProceed, logsCsv, pauseLabels, spDay, spTime, type MonitorLog, type MonitorSequence } from "@/lib/sequence-monitor";
import { nextWeeklyRound, formatWeeklyRound } from "@/lib/sequence-schedule";

export const Route = createFileRoute("/_app/sequencias-dashboard")({
  component: SequencesDashboard,
  head: () => ({ meta: [
    { title: "Painel de sequências | ZapCRM" },
    { name: "description", content: "Acompanhe rodadas, histórico de mensagens, falhas e confirmações das sequências do ZapCRM." },
    { property: "og:title", content: "Painel de sequências | ZapCRM" },
    { property: "og:description", content: "Relatórios e acompanhamento atualizado das sequências de mensagens do ZapCRM." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
});
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PAGE_SIZE = 25;
function ResultBadge({ status }: { status: string }) {
  const success = status === "sent" || status === "completed";
  const failure = status === "failed";
  const labels: Record<string, string> = { sent: "Sucesso · API", failed: "Falhou", active: "Pendente", completed: "Concluída", skipped: "Pulada", expired: "Expirada", paused: "Pausado", cancelled: "Cancelado" };
  return <Badge variant="outline" className={success ? "text-success border-success/30 bg-success/5" : failure ? "text-destructive border-destructive/30 bg-destructive/5" : "text-muted-foreground"}>{labels[status] ?? status}</Badge>;
}
function Metric({ label, value, icon: Icon, tone = "text-primary", hint }: { label: string; value: number | string; icon: typeof Activity; tone?: string; hint?: string }) {
  return <Card className="rounded-lg p-4 flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`font-semibold mt-2 tabular-nums break-words ${typeof value === "string" && value.length > 6 ? "text-sm" : "text-2xl"} ${tone}`}>{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div><Icon className={`size-5 shrink-0 ${tone}`} /></Card>;
}
function SequencesDashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("7");
  const [start, setStart] = useState(() => spDay(new Date(Date.now() - 6 * 86400000)));
  const [end, setEnd] = useState(() => spDay());
  const [live, setLive] = useState(true);
  const [sequenceId, setSequenceId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("live");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MonitorLog | null>(null);
  const { snapshot: data, loading, refreshing, error, updatedAt, refresh } = useSequenceMonitor(user?.id, start, end, live);
  const today = spDay();
  const sequences = data.sequences.filter(s => sequenceId === "all" || s.id === sequenceId);
  const selectedIds = new Set(sequences.map(s => s.id));
  const enrollmentMap = new Map(data.enrollments.map(e => [e.id, e]));
  const sequenceMap = new Map(data.sequences.map(s => [s.id, s]));
  const enrollments = data.enrollments.filter(e => selectedIds.has(e.sequence_id));
  const claims = data.claims.filter(c => selectedIds.has(c.sequence_id));
  const occurrences = data.occurrences.filter(o => selectedIds.has(o.sequence_id));
  const periodOccurrences = occurrences.filter(o => (!start || o.scheduled_date >= start) && (!end || o.scheduled_date <= end));
  const activeRounds = occurrences.filter(o => o.status === "active" && canProceed(enrollmentMap.get(o.contact_sequence_id), sequenceMap.get(o.sequence_id)));
  const logs = data.logs.filter(log => sequenceId === "all" || selectedIds.has(log.contact_sequences?.sequence_id ?? ""));
  const sent = logs.filter(l => l.status === "sent").length;
  const failed = logs.filter(l => l.status === "failed").length;
  const pendingCount = activeRounds.length + enrollments.filter(e => !sequenceMap.get(e.sequence_id)?.recurrence_enabled && e.status === "active" && !e.crm_contacts?.is_ignored).length;
  const filteredLogs = logs.filter(log => (status === "all" || log.status === status) &&
    `${log.contact_sequences?.crm_contacts?.name ?? ""} ${log.contact_sequences?.crm_contacts?.phone ?? ""} ${log.message} ${log.error ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const shownLogs = filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const chart = useMemo(() => {
    const buckets = new Map<string, { date: string; sucesso: number; falhas: number }>();
    logs.forEach(log => { const day = spDay(log.sent_at); const row = buckets.get(day) ?? { date: day, sucesso: 0, falhas: 0 }; if (log.status === "sent") row.sucesso++; if (log.status === "failed") row.falhas++; buckets.set(day, row); });
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data.logs, sequenceId]);
  const choosePeriod = (value: string) => {
    setPeriod(value); setPage(1);
    if (value === "custom") return;
    setEnd(value === "all" ? "" : today);
    setStart(value === "all" ? "" : spDay(new Date(Date.now() - (Number(value) - 1) * 86400000)));
  };
  const showFailures = () => { setStatus("failed"); setTab("history"); setPage(1); };
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([logsCsv(filteredLogs)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `ZapCRM_sequencias_${start || "inicio"}_${end || today}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const scheduleState = (sequence: MonitorSequence) => {
    const now = new Date(); const local = new Date(now.getTime() - 3 * 3600_000);
    if (!sequence.is_active) return "Pausada";
    if (!sequence.window_days.includes(local.getUTCDay()) || local.getUTCHours() < sequence.window_start_hour || local.getUTCHours() >= sequence.window_end_hour) return "Fora da janela";
    if (claims.some(c => c.sequence_id === sequence.id)) return "Aguardando confirmação";
    if (!data.claimsAvailable) return "Confirmações indisponíveis";
    if (sequence.next_client_at && new Date(sequence.next_client_at) > now) return "Intervalo entre clientes";
    return "Janela aberta";
  };
  return <div className="max-w-[1440px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Activity className="size-6 text-primary" /> Painel de sequências</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${error ? "bg-destructive" : live ? "bg-success" : "bg-muted-foreground"}`} />{live ? "Atualização a cada 15 segundos" : "Atualização automática pausada"}<span>· São Paulo</span><span>· Última consulta: {updatedAt ? spTime(updatedAt) : "—"}</span></div></div>
      <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm"><Switch checked={live} onCheckedChange={setLive} aria-label="Atualização automática" /> Ao vivo</label>
        <Button variant="outline" size="icon" title="Atualizar agora" aria-label="Atualizar agora" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /></Button>
        <Button asChild variant="outline" size="sm"><Link to="/sequencias">Gerenciar sequências</Link></Button></div>
    </header>
    <div className="flex flex-wrap items-end gap-3 border-b pb-4">
      <div className="w-full sm:w-64"><label className="block text-xs text-muted-foreground mb-1.5">Sequência</label><Select value={sequenceId} onValueChange={v => { setSequenceId(v); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as sequências</SelectItem>{data.sequences.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="w-44"><label className="block text-xs text-muted-foreground mb-1.5">Período do relatório</label><Select value={period} onValueChange={choosePeriod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Hoje</SelectItem><SelectItem value="7">Últimos 7 dias</SelectItem><SelectItem value="30">Últimos 30 dias</SelectItem><SelectItem value="all">Todo o histórico</SelectItem><SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select></div>
      {period === "custom" && <><label className="text-xs text-muted-foreground">De<Input aria-label="Data inicial" type="date" value={start} onChange={e => { setStart(e.target.value); setPage(1); }} /></label><label className="text-xs text-muted-foreground">Até<Input aria-label="Data final" type="date" value={end} onChange={e => { setEnd(e.target.value); setPage(1); }} /></label></>}
    </div>
    {error && <div role="alert" className="border border-destructive/30 bg-destructive/5 text-destructive p-3 text-sm break-words">Falha na atualização: {error}{updatedAt && " Os dados anteriores permanecem visíveis."}</div>}
    {data.warnings.map(w => <div role="status" key={w} className="border border-warning/40 bg-warning/5 p-3 text-sm break-words"><AlertTriangle className="size-4 inline mr-2 text-warning" />{w}</div>)}
    {loading ? <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Carregando relatório…</div> : !updatedAt && error ? <Empty text="Relatório indisponível. Tente atualizar novamente." /> : <>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric label="Envios bem-sucedidos" value={sent} icon={CheckCircle2} tone="text-success" hint="Aceitos pela API" />
        <Metric label="Disparos falhados" value={failed} icon={XCircle} tone="text-destructive" />
        <Metric label="Rodadas/contatos pendentes" value={data.occurrencesAvailable ? pendingCount : "—"} icon={Clock} />
        <Metric label="Sem confirmação" value={data.claimsAvailable ? claims.length : "Indisponível"} icon={AlertTriangle} tone="text-warning" />
        <Metric label="Inscrições pausadas" value={enrollments.filter(e => e.status === "paused").length} icon={Users} tone="text-muted-foreground" />
        <Metric label="Pausados por resposta" value={enrollments.filter(e => e.pause_reason === "inbound_reply" && e.status === "paused").length} icon={MessageSquareReply} tone="text-accent" />
      </div>
      <p className="text-xs text-muted-foreground">Sucesso significa aceitação pela API do WhatsApp; não comprova entrega ou leitura no aparelho.</p>
      {failed > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-destructive bg-destructive/5 p-3"><p className="text-sm"><strong>{failed} falha(s)</strong> no período selecionado.</p><Button size="sm" variant="outline" onClick={showFailures}><XCircle className="size-4 mr-2" /> Ver falhas</Button></div>}
      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="max-w-full h-auto flex-wrap"><TabsTrigger value="live">Agora</TabsTrigger><TabsTrigger value="history">Histórico de envios</TabsTrigger><TabsTrigger value="rounds">Rodadas</TabsTrigger><TabsTrigger value="metrics">Métricas</TabsTrigger></TabsList>
        <TabsContent value="live" className="space-y-5">
          <div><h2 className="font-semibold mb-3">Sequências e andamento de hoje</h2><div className="grid gap-3 lg:grid-cols-2">{sequences.map(s => {
            const rounds = occurrences.filter(o => o.sequence_id === s.id && o.scheduled_date === today);
            const done = rounds.filter(o => o.status === "completed").length;
            const seqEnrollments = enrollments.filter(e => e.sequence_id === s.id);
            const eligible = seqEnrollments.filter(e => canProceed(e, s)).length;
            const seqLogs = logs.filter(l => l.contact_sequences?.sequence_id === s.id);
            const eligibleRounds = rounds.filter(o => o.status === "active" && canProceed(enrollmentMap.get(o.contact_sequence_id), s));
            const last = seqLogs[0];
            const next = eligibleRounds.map(o => o.next_send_at).filter((v): v is string => Boolean(v)).sort()[0];
            return <Card key={s.id} className="rounded-lg p-4 space-y-3"><div className="flex flex-wrap justify-between items-start gap-2"><h3 className="font-semibold break-words">{s.name}</h3><Badge variant="outline">{scheduleState(s)}</Badge></div>
              <p className="text-xs text-muted-foreground">{s.window_days.map(d => DAYS[d]).join(" · ")} · {s.window_start_hour}h–{s.window_end_hour}h · {s.client_interval_seconds}s entre clientes · {s.recurrence_enabled ? "Semanal" : "Única"}</p>
              <div className="grid grid-cols-3 gap-2 text-sm"><div><strong>{eligible}</strong><p className="text-xs text-muted-foreground">Elegíveis agora</p></div><div><strong>{done}/{rounds.length}</strong><p className="text-xs text-muted-foreground">Rodadas concluídas hoje</p></div><div><strong>{seqEnrollments.filter(e => e.status === "paused" || e.crm_contacts?.is_ignored).length}</strong><p className="text-xs text-muted-foreground">Pausados/excluídos</p></div></div>
              <Progress value={rounds.length ? done / rounds.length * 100 : 0} aria-label={`Rodadas concluídas de ${s.name}`} />
              <div className="space-y-1 text-xs text-muted-foreground"><p>Último resultado no período: {last ? `${spTime(last.sent_at)} · ${last.status === "sent" ? "sucesso" : "falha"}` : "Nenhum"}</p><p>Próxima etapa registrada: {spTime(next ?? null)}</p><p>Próxima abertura prevista: {s.is_active ? formatWeeklyRound(nextWeeklyRound({ windowDays: s.window_days, windowStartHour: s.window_start_hour, windowEndHour: s.window_end_hour })) : "Pausada"}</p></div>
            </Card>;
          })}</div>{!sequences.length && <Empty text="Nenhuma sequência encontrada." />}</div>
          {claims.length > 0 && <section className="border-t pt-4"><h2 className="font-semibold flex gap-2 items-center text-warning"><AlertTriangle className="size-4" /> Envios aguardando confirmação</h2><p className="text-xs text-muted-foreground mt-1">Uma reserva pode estar em processamento ou ter resultado incerto. Não reenviar sem conferência.</p><div className="divide-y">{claims.map(c => <div key={c.id} className="py-3 text-sm"><strong>{sequenceMap.get(c.sequence_id)?.name}</strong> · {enrollmentMap.get(c.contact_sequence_id)?.crm_contacts?.name ?? "Contato removido"} · Etapa {c.step_order}<p className="text-xs text-muted-foreground">Reservado em {spTime(c.reserved_at)}</p></div>)}</div></section>}
          <section className="border-t pt-4"><h2 className="font-semibold mb-3">Fila de etapas registradas</h2><div className="divide-y">{activeRounds.slice().sort((a,b) => (a.next_send_at ?? "").localeCompare(b.next_send_at ?? "")).slice(0, 50).map(o => <div key={o.id} className="py-3 flex flex-wrap justify-between gap-2 text-sm"><div><strong>{sequenceMap.get(o.sequence_id)?.name}</strong><p className="text-muted-foreground">{enrollmentMap.get(o.contact_sequence_id)?.crm_contacts?.name ?? "Contato removido"} · Etapa {o.current_step} · Rodada {o.scheduled_date.split("-").reverse().join("/")}</p></div><span className="text-xs text-muted-foreground">Previsto: {spTime(o.next_send_at)}</span></div>)}</div>{!activeRounds.length && <Empty text="Nenhuma rodada elegível em andamento." />}{activeRounds.length > 50 && <p className="text-xs text-muted-foreground">Exibindo os 50 primeiros de {activeRounds.length}. Consulte todas na aba Rodadas.</p>}</section>
        </TabsContent>
        <TabsContent value="history" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center"><div className="relative flex-1 min-w-48"><Search className="size-4 absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Buscar no relatório" className="pl-9" placeholder="Contato, telefone, mensagem ou erro" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os resultados</SelectItem><SelectItem value="sent">Bem-sucedidos</SelectItem><SelectItem value="failed">Falhados</SelectItem></SelectContent></Select><Button variant="outline" onClick={exportReport} disabled={!filteredLogs.length || refreshing || Boolean(error)}><Download className="size-4 mr-2" /> Exportar CSV</Button></div>
          <div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{["Data · São Paulo", "Sequência / contato", "Etapa", "Resultado", "Detalhes"].map(t => <th key={t} className="p-3 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y">{shownLogs.map(l => <tr key={l.id}><td className="p-3 whitespace-nowrap text-xs tabular-nums">{spTime(l.sent_at)}</td><td className="p-3 min-w-52"><p className="font-medium">{l.contact_sequences?.crm_sequences?.name ?? "Sequência removida"}</p><p>{l.contact_sequences?.crm_contacts?.name ?? "Contato removido"}</p><p className="text-xs text-muted-foreground">{l.contact_sequences?.crm_contacts?.phone}</p></td><td className="p-3">{l.step_order}</td><td className="p-3 whitespace-nowrap"><ResultBadge status={l.status} /></td><td className="p-3"><Button variant="ghost" size="icon" aria-label="Ver detalhes do envio" title="Ver mensagem e resultado" onClick={() => setDetail(l)}><Eye className="size-4" /></Button></td></tr>)}</tbody></table>{!shownLogs.length && <Empty text="Nenhum envio encontrado para estes filtros." />}</div>
          <div className="flex justify-between gap-2 items-center text-xs text-muted-foreground"><span>{filteredLogs.length} registros · Página {currentPage} de {totalPages}</span><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Próxima página" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4" /></Button></div></div>
        </TabsContent>
        <TabsContent value="rounds"><RoundsTable rounds={periodOccurrences} data={data} /></TabsContent>
        <TabsContent value="metrics" className="space-y-6"><section><h2 className="font-semibold mb-4">Envios por dia</h2><div className="h-72">{chart.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={v => String(v).split("-").reverse().slice(0,2).join("/")} stroke="var(--muted-foreground)" fontSize={11} /><YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }} /><Area dataKey="sucesso" name="Aceitos pela API" stroke="var(--success)" fill="var(--success)" fillOpacity={0.12} /><Area dataKey="falhas" name="Falhas" stroke="var(--destructive)" fill="var(--destructive)" fillOpacity={0.08} /></AreaChart></ResponsiveContainer> : <Empty text="Nenhum envio no período." />}</div></section><section className="border-t pt-4"><h2 className="font-semibold mb-3">Resultados por sequência</h2><div className="divide-y">{sequences.map(s => { const list = logs.filter(l => l.contact_sequences?.sequence_id === s.id); const success = list.filter(l => l.status === "sent").length; return <div key={s.id} className="py-3 flex flex-wrap justify-between gap-2 text-sm"><strong>{s.name}</strong><span>{success} bem-sucedidos · {list.filter(l => l.status === "failed").length} falhas · {list.length ? Math.round(success / list.length * 100) : 0}% de sucesso</span></div>; })}</div></section></TabsContent>
      </Tabs>
    </>}
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Detalhes do envio</DialogTitle></DialogHeader>{detail && <div className="space-y-4 text-sm"><ResultBadge status={detail.status} /><dl className="space-y-2"><div><dt className="text-muted-foreground">Sequência</dt><dd>{detail.contact_sequences?.crm_sequences?.name ?? "Removida"}</dd></div><div><dt className="text-muted-foreground">Contato</dt><dd>{detail.contact_sequences?.crm_contacts?.name ?? "Removido"} · {detail.contact_sequences?.crm_contacts?.phone}</dd></div><div><dt className="text-muted-foreground">Data e etapa</dt><dd>{spTime(detail.sent_at)} · Etapa {detail.step_order}</dd></div></dl><div><h3 className="font-medium mb-2">Mensagem registrada</h3><p className="whitespace-pre-wrap break-words bg-muted/50 p-3 rounded-md">{detail.message || "Sem texto registrado"}</p></div>{detail.error && <div><h3 className="font-medium text-destructive mb-2">Motivo da falha</h3><p className="whitespace-pre-wrap break-words">{detail.error}</p></div>}<p className="text-xs text-muted-foreground break-all">Registro: {detail.id}<br />Rodada: {detail.occurrence_id ?? "Envio único"}</p></div>}</DialogContent></Dialog>
  </div>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>; }
function RoundsTable({ rounds, data }: { rounds: ReturnType<typeof useSequenceMonitor>["snapshot"]["occurrences"]; data: ReturnType<typeof useSequenceMonitor>["snapshot"] }) {
  const [page, setPage] = useState(1);
  const count = Math.max(1, Math.ceil(rounds.length / PAGE_SIZE)); const current = Math.min(page, count);
  return <div className="space-y-3"><div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground text-left"><tr>{["Data da rodada", "Sequência / contato", "Etapa", "Estado", "Próxima etapa / conclusão"].map(t => <th key={t} className="p-3 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y">{rounds.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(o => { const e = data.enrollments.find(e => e.id === o.contact_sequence_id); const s = data.sequences.find(s => s.id === o.sequence_id); return <tr key={o.id}><td className="p-3 whitespace-nowrap">{o.scheduled_date.split("-").reverse().join("/")}</td><td className="p-3 min-w-52"><p className="font-medium">{s?.name ?? "Sequência removida"}</p><p className="text-muted-foreground">{e?.crm_contacts?.name ?? "Contato removido"}</p></td><td className="p-3">{o.current_step}</td><td className="p-3"><ResultBadge status={o.status} />{o.status === "active" && !canProceed(e, s) && <p className="text-xs text-muted-foreground mt-1">{!s?.is_active ? "Sequência pausada" : e?.crm_contacts?.is_ignored ? "Contato excluído dos envios" : pauseLabels[e?.pause_reason ?? ""] ?? "Inscrição pausada"}</p>}</td><td className="p-3 whitespace-nowrap text-xs">{spTime(o.completed_at ?? o.next_send_at)}</td></tr>; })}</tbody></table>{!rounds.length && <Empty text={data.occurrencesAvailable ? "Nenhuma rodada no período." : "Não foi possível consultar as rodadas."} />}</div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{rounds.length} rodadas · Página {current} de {count}</span><div className="flex gap-1"><Button size="icon" variant="outline" aria-label="Rodadas anteriores" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft className="size-4" /></Button><Button size="icon" variant="outline" aria-label="Próximas rodadas" disabled={current >= count} onClick={() => setPage(current + 1)}><ChevronRight className="size-4" /></Button></div></div></div>;
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, CheckCircle2, XCircle, Loader2, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listEnrichmentLogs,
  deleteEnrichmentLogs,
} from "@/server/ai-enrichment-logs.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/historico-ia")({
  component: HistoricoIaPage,
});

type Log = {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: "dispatched" | "success" | "error";
  error_message: string | null;
  triggered_at: string;
  completed_at: string | null;
  created_at: string;
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR");
}

function StatusBadge({ s }: { s: Log["status"] }) {
  if (s === "success") {
    return (
      <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 gap-1">
        <CheckCircle2 className="size-3" /> Sucesso
      </Badge>
    );
  }
  if (s === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" /> Erro
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Loader2 className="size-3 animate-spin" /> Disparado
    </Badge>
  );
}

function HistoricoIaPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await listEnrichmentLogs({ data: { limit: 100 } });
      setLogs(r.logs as Log[]);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteForContact = async (contactId: string | null, name: string | null) => {
    if (!contactId) {
      toast.error("Log sem contact_id — não é possível filtrar");
      return;
    }
    const label = name ?? "este contato";
    if (!confirm(`Remover TODOS os logs de "${label}" do histórico?`)) return;
    setBusy(contactId);
    try {
      const r = await deleteEnrichmentLogs({ data: { contact_id: contactId } });
      toast.success(`${r.deleted} log(s) removido(s)`);
      await refresh();
    } catch (e: any) {
      toast.error(`Erro ao remover: ${e.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const counts = logs.reduce(
    (acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-[image:var(--gradient-primary)] grid place-items-center text-primary-foreground shadow-[var(--shadow-elegant)]">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Histórico de Enriquecimentos</h1>
            <p className="text-sm text-muted-foreground">
              Disparos do botão ✨ enviados para a IA, com status e timestamps.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={logs.length} />
        <StatCard label="Sucesso" value={counts.success ?? 0} tone="green" />
        <StatCard label="Em andamento" value={counts.dispatched ?? 0} tone="blue" />
        <StatCard label="Erros" value={counts.error ?? 0} tone="red" />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contato</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Disparo</TableHead>
              <TableHead>Conclusão</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  <Clock className="size-5 inline mr-2 opacity-50" />
                  Nenhum enriquecimento disparado ainda. Use o botão ✨ na lista de contatos.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((l) => {
                const dur =
                  l.completed_at && l.triggered_at
                    ? Math.max(
                        0,
                        Math.round(
                          (new Date(l.completed_at).getTime() -
                            new Date(l.triggered_at).getTime()) /
                            1000,
                        ),
                      )
                    : null;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.contact_id ? (
                        <Link
                          to="/contatos"
                          className="hover:underline text-primary"
                        >
                          {l.contact_name ?? "(sem nome)"}
                        </Link>
                      ) : (
                        l.contact_name ?? "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {l.contact_phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={l.status} />
                    </TableCell>
                    <TableCell className="text-sm">{fmt(l.triggered_at)}</TableCell>
                    <TableCell className="text-sm">{fmt(l.completed_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {dur !== null ? `${dur}s` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                      {l.error_message ?? ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "red" | "blue";
}) {
  const toneCls =
    tone === "green"
      ? "text-green-600 dark:text-green-400"
      : tone === "red"
        ? "text-red-600 dark:text-red-400"
        : tone === "blue"
          ? "text-blue-600 dark:text-blue-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

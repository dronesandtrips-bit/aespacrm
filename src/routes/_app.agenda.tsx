// Agenda — lista os compromissos do Google Agenda conectado e permite
// editar (título, data/hora, duração, local, descrição) ou cancelar.
// Aditivo: não altera o fluxo de agendamento pelo WhatsWeb.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";

export const Route = createFileRoute("/_app/agenda")({
  component: AgendaPage,
});

type CalEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  htmlLink: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationOf(e: CalEvent): string {
  if (!e.start || !e.end) return "60";
  const mins = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000);
  const allowed = [15, 30, 60, 90, 120, 240];
  const nearest = allowed.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a), 60);
  return String(nearest);
}

function AgendaPage() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/public/calendar/events?days=120&past=7");
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      setEvents(json.events ?? []);
    } catch (e: any) {
      toast.error(`Falha ao carregar agenda: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (e: CalEvent) => {
    setEditing(e);
    setTitle(e.title);
    setWhen(e.start ? toLocalInput(e.start) : "");
    setDuration(durationOf(e));
    setLocation(e.location ?? "");
    setDescription(e.description ?? "");
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!title.trim()) {
      toast.error("Informe um título");
      return;
    }
    const start = new Date(when);
    if (Number.isNaN(start.getTime())) {
      toast.error("Data/hora inválida");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/public/calendar/update-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: editing.id,
          title: title.trim(),
          startISO: start.toISOString(),
          durationMinutes: Number(duration),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success(
        json?.remindersUpdated
          ? `Compromisso atualizado — ${json.remindersUpdated} lembrete(s) reajustado(s)`
          : "Compromisso atualizado",
      );
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: CalEvent) => {
    if (!window.confirm(`Cancelar "${e.title}"? O evento sai do Google Agenda.`)) return;
    setDeletingId(e.id);
    try {
      const res = await authFetch("/api/public/calendar/delete-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: e.id }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success("Compromisso cancelado");
      setEvents((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err: any) {
      toast.error(`Falha ao cancelar: ${err?.message ?? String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const grouped = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => e.start && new Date(e.start).getTime() >= now);
    const past = events
      .filter((e) => e.start && new Date(e.start).getTime() < now)
      .reverse();
    return { upcoming, past };
  }, [events]);

  const renderRow = (e: CalEvent) => (
    <div
      key={e.id}
      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{e.title}</div>
        <div className="text-sm text-muted-foreground">
          {e.start
            ? new Date(e.start).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: e.allDay ? undefined : "short",
              })
            : "—"}
        </div>
        {e.location && (
          <div className="flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {e.location}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {e.htmlLink && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(e.htmlLink!, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="size-4" />
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => openEdit(e)}>
          <Pencil className="size-4" />
          Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={deletingId === e.id}
          onClick={() => handleDelete(e)}
        >
          {deletingId === e.id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <CalendarDays className="size-5" />
          Agenda
        </h1>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Atualizar
        </Button>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando compromissos…</Card>
      ) : (
        <>
          <Card className="space-y-2 p-4">
            <div className="text-sm font-medium text-muted-foreground">Próximos</div>
            {grouped.upcoming.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhum compromisso futuro.</div>
            ) : (
              grouped.upcoming.map(renderRow)
            )}
          </Card>

          {grouped.past.length > 0 && (
            <Card className="space-y-2 p-4">
              <div className="text-sm font-medium text-muted-foreground">Últimos 7 dias</div>
              {grouped.past.map(renderRow)}
            </Card>
          )}
        </>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar compromisso</DialogTitle>
            <DialogDescription>
              As alterações vão para o Google Agenda e reajustam os lembretes pendentes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ed-title">Título</Label>
              <Input
                id="ed-title"
                value={title}
                maxLength={200}
                onChange={(ev) => setTitle(ev.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-when">Data e hora</Label>
                <Input
                  id="ed-when"
                  type="datetime-local"
                  value={when}
                  onChange={(ev) => setWhen(ev.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-duration">Duração</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="ed-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutos</SelectItem>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="90">1h30</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                    <SelectItem value="240">4 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ed-location" className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                Local
              </Label>
              <Input
                id="ed-location"
                value={location}
                maxLength={300}
                onChange={(ev) => setLocation(ev.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ed-desc">Descrição</Label>
              <Textarea
                id="ed-desc"
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

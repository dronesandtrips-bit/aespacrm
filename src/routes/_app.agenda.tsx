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
import { Switch } from "@/components/ui/switch";
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
  Bot,
  CheckCircle2,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { contactsDb, type Contact } from "@/lib/db";

const DEFAULT_OWNER_PHONE = "5554991495959";

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
  pending?: boolean;
  reminder?: {
    contactPhone: string;
    contactName: string;
    ownerPhone: string;
    reminderMinutes: number | null;
  } | null;
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
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"lista" | "semana">("semana");
  const [movingId, setMovingId] = useState<string | null>(null);


  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState(DEFAULT_OWNER_PHONE);
  const [reminderMinutes, setReminderMinutes] = useState("60");
  const [notifyNow, setNotifyNow] = useState(true);

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

  useEffect(() => {
    contactsDb
      .list()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  const contactMatches = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    return contacts
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          (digits.length >= 3 && (c.phone ?? "").includes(digits)),
      )
      .slice(0, 6);
  }, [contactQuery, contacts]);

  const openEdit = (e: CalEvent) => {
    setEditing(e);
    setTitle(e.title);
    setWhen(e.start ? toLocalInput(e.start) : "");
    setDuration(durationOf(e));
    setLocation(e.location ?? "");
    setDescription(e.description ?? "");
    setContactPhone(e.reminder?.contactPhone ?? "");
    setContactName(e.reminder?.contactName ?? "");
    setContactQuery(
      e.reminder?.contactName || e.reminder?.contactPhone
        ? `${e.reminder?.contactName ?? ""}`.trim() || (e.reminder?.contactPhone ?? "")
        : "",
    );
    setOwnerPhone(e.reminder?.ownerPhone ?? DEFAULT_OWNER_PHONE);
    setReminderMinutes(String(e.reminder?.reminderMinutes ?? 60));
  };

  const openCreate = (at?: Date) => {
    const d = at ? new Date(at) : new Date();
    if (!at) {
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
    }
    setEditing(null);
    setCreating(true);
    setTitle("");
    setWhen(toLocalInput(d.toISOString()));
    setDuration("60");
    setLocation("");
    setDescription("");
    setContactPhone("");
    setContactName("");
    setContactQuery("");
    setOwnerPhone(DEFAULT_OWNER_PHONE);
    setReminderMinutes("60");
    setNotifyNow(true);
  };

  // Arrastar um bloco na visão semanal reagenda o compromisso.
  const handleMove = async (ev: CalEvent, newStart: Date) => {
    const mins =
      ev.start && ev.end
        ? Math.max(5, Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60000))
        : 60;
    setMovingId(ev.id);
    const prev = events;
    setEvents((list) =>
      list.map((x) =>
        x.id === ev.id
          ? {
              ...x,
              start: newStart.toISOString(),
              end: new Date(newStart.getTime() + mins * 60_000).toISOString(),
            }
          : x,
      ),
    );
    try {
      const res = await authFetch("/api/public/calendar/update-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: ev.id,
          title: ev.title,
          startISO: newStart.toISOString(),
          durationMinutes: mins,
          description: ev.description || undefined,
          location: ev.location || undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success(
        `Reagendado para ${newStart.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`,
      );
      await load();
    } catch (e: any) {
      setEvents(prev);
      toast.error(`Falha ao reagendar: ${e?.message ?? String(e)}`);
    } finally {
      setMovingId(null);
    }
  };


  const handleSave = async () => {
    if (!editing && !creating) return;
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
      const res = await authFetch(
        editing ? "/api/public/calendar/update-event" : "/api/public/calendar/create-event",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(editing ? { eventId: editing.id, replaceReminders: true } : {}),
            title: title.trim(),
            startISO: start.toISOString(),
            durationMinutes: Number(duration),
            description: description.trim() || undefined,
            location: location.trim() || undefined,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
            reminderMinutes: Number(reminderMinutes),
            contactName: contactName.trim() || undefined,
            contactPhone: contactPhone.replace(/\D/g, "") || undefined,
            ownerPhone: ownerPhone.replace(/\D/g, "") || undefined,
            notifyNow,
          }),
        },
      );
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success(
        editing
          ? json?.remindersUpdated
            ? `Compromisso atualizado — ${json.remindersUpdated} lembrete(s) reajustado(s)`
            : "Compromisso atualizado"
          : json?.remindersCreated
            ? `Compromisso criado — ${json.remindersCreated} lembrete(s) agendado(s)`
            : "Compromisso criado",
      );
      if (notifyNow) {
        if (json?.notified) toast.success("Cliente avisada no WhatsApp");
        else if (json?.notifyError) toast.error(`Não avisei a cliente: ${json.notifyError}`);
      }
      setEditing(null);
      setCreating(false);

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

  const handleConfirm = async (e: CalEvent) => {
    setConfirmingId(e.id);
    try {
      const res = await authFetch("/api/public/calendar/confirm-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: e.id }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success(
        json?.remindersActivated
          ? `Compromisso confirmado — ${json.remindersActivated} lembrete(s) ativado(s)`
          : "Compromisso confirmado",
      );
      await load();
    } catch (err: any) {
      toast.error(`Falha ao confirmar: ${err?.message ?? String(err)}`);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
      start.setMinutes(0, 0, 0);
      const res = await authFetch("/api/public/calendar/auto-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: DEFAULT_OWNER_PHONE,
          name: "Cliente Teste",
          title: "Teste de agendamento do Robô",
          startISO: start.toISOString(),
          durationMinutes: 60,
          location: "Rua Bento Gonçalves, 1000 - Caxias do Sul, RS",
          reminderMinutes: 60,
          ownerPhone: DEFAULT_OWNER_PHONE,
        }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? res.statusText);
      toast.success(
        json?.ownerNotified
          ? "Simulação criada — confira o WhatsApp e a lista abaixo"
          : "Simulação criada (aviso no WhatsApp não saiu — veja a conexão)",
      );
      await load();
    } catch (err: any) {
      toast.error(`Falha na simulação: ${err?.message ?? String(err)}`);
    } finally {
      setSimulating(false);
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
        <div className="flex items-center gap-2">
          {e.pending && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              A confirmar
            </span>
          )}
          <span className="truncate font-medium">{e.title}</span>
        </div>
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
        {e.pending && (
          <Button size="sm" disabled={confirmingId === e.id} onClick={() => handleConfirm(e)}>
            {confirmingId === e.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Confirmar
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
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["semana", "lista"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize ${
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSimulate()}
            disabled={simulating}
          >
            {simulating ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
            Testar robô
          </Button>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="size-4" />
            Novo compromisso
          </Button>
        </div>

      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando compromissos…</Card>
      ) : view === "semana" ? (
        <AgendaWeekView
          events={events}
          movingId={movingId}
          onCreateAt={(d) => openCreate(d)}
          onOpen={(ev) => {
            const full = events.find((x) => x.id === ev.id);
            if (full) openEdit(full);
          }}
          onMove={(ev, d) => {
            const full = events.find((x) => x.id === ev.id);
            if (full) void handleMove(full, d);
          }}
        />
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


      <Dialog
        open={Boolean(editing) || creating}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "As alterações vão para o Google Agenda e reajustam os lembretes pendentes."
                : "Cria o evento no Google Agenda e agenda os lembretes no WhatsApp."}
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
              <Label htmlFor="ed-contact" className="flex items-center gap-1.5">
                <UserPlus className="size-3.5" />
                Contato do cliente
              </Label>
              <Input
                id="ed-contact"
                placeholder="Pesquisar por nome ou telefone…"
                value={contactQuery}
                onChange={(ev) => {
                  setContactQuery(ev.target.value);
                  const digits = ev.target.value.replace(/\D/g, "");
                  if (digits.length >= 10) {
                    setContactPhone(digits);
                    setContactName(ev.target.value.replace(/[\d\s+()-]/g, "").trim());
                  }
                }}
              />
              {contactMatches.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border border-border">
                  {contactMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setContactPhone(c.phone ?? "");
                        setContactName(c.name ?? "");
                        setContactQuery(c.name ?? c.phone ?? "");
                      }}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {contactPhone && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Notificações para: {contactName || "cliente"} ({contactPhone})
                  </span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setContactPhone("");
                      setContactName("");
                      setContactQuery("");
                    }}
                  >
                    remover
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-remind">Lembrete antes</Label>
                <Select value={reminderMinutes} onValueChange={setReminderMinutes}>
                  <SelectTrigger id="ed-remind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutos</SelectItem>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                    <SelectItem value="1440">1 dia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-owner">Meu WhatsApp</Label>
                <Input
                  id="ed-owner"
                  inputMode="numeric"
                  value={ownerPhone}
                  onChange={(ev) => setOwnerPhone(ev.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ed-notify">
                  {editing ? "Avisar o cliente da alteração agora" : "Avisar o cliente agora"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {editing
                    ? "Envia no WhatsApp o novo horário/local do compromisso na hora."
                    : "Envia a confirmação do compromisso no WhatsApp na hora (além do lembrete automático)."}
                </p>
              </div>
              <Switch id="ed-notify" checked={notifyNow} onCheckedChange={setNotifyNow} />
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
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Salvar" : "Agendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

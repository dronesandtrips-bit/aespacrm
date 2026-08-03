// Diálogo de agendamento no Google Agenda a partir de uma conversa do WhatsWeb.
// Aditivo: não altera nenhum fluxo existente da inbox.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { CalendarPlus, Copy, Loader2, MapPin, Send } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
  /** fetch já autenticado (mesmo helper usado nas demais chamadas da inbox) */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** opcional: envia um texto para o contato no WhatsApp */
  onSendToContact?: (text: string) => Promise<void> | void;
};

// Valor inicial para <input type="datetime-local"> — próxima hora cheia.
function defaultLocalDateTime(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Created = {
  htmlLink: string | null;
  mapsLink: string | null;
  location: string | null;
  startISO: string;
  title: string;
};

export function ScheduleEventDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
  authFetch,
  onSendToContact,
}: Props) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultLocalDateTime());
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("60");
  const [remindClient, setRemindClient] = useState(true);
  const [ownerPhone, setOwnerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const conversationLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/inbox`;
  }, []);

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setTitle(`Compromisso — ${contactName}`);
    setWhen(defaultLocalDateTime());
    setDuration("60");
    setLocation("");
    setReminderMinutes("60");
    setRemindClient(true);
    try {
      setOwnerPhone(window.localStorage.getItem("zapcrm:ownerPhone") ?? "");
    } catch {
      /* ignore */
    }
    setDescription(
      [
        `Contato: ${contactName}`,
        `WhatsApp: ${contactPhone}`,
        conversationLink ? `Conversa no CRM: ${conversationLink}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }, [open, contactName, contactPhone, conversationLink]);

  const shareText = useMemo(() => {
    if (!created) return "";
    const dt = new Date(created.startISO);
    const quando = dt.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    return [
      `Olá ${contactName}! Agendei nosso compromisso: ${created.title}`,
      `Data: ${quando}`,
      created.location ? `Local: ${created.location}` : "",
      created.mapsLink ? `Mapa: ${created.mapsLink}` : "",
      created.htmlLink ? `Agenda: ${created.htmlLink}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [created, contactName]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Informe um título para o compromisso");
      return;
    }
    const start = new Date(when);
    if (Number.isNaN(start.getTime())) {
      toast.error("Data/hora inválida");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/public/calendar/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startISO: start.toISOString(),
          durationMinutes: Number(duration),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          reminderMinutes: reminderMinutes === "0" ? undefined : Number(reminderMinutes),
          contactName,
          contactPhone:
            reminderMinutes !== "0" && remindClient
              ? contactPhone.replace(/\D/g, "")
              : undefined,
          ownerPhone:
            reminderMinutes !== "0" && ownerPhone.replace(/\D/g, "").length >= 10
              ? ownerPhone.replace(/\D/g, "")
              : undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? res.statusText);
      }
      try {
        const digits = ownerPhone.replace(/\D/g, "");
        if (digits.length >= 10) window.localStorage.setItem("zapcrm:ownerPhone", digits);
      } catch {
        /* ignore */
      }
      toast.success(
        json?.remindersCreated
          ? `Compromisso criado — ${json.remindersCreated} lembrete(s) agendado(s)`
          : "Compromisso criado no Google Agenda",
      );
      setCreated({
        htmlLink: json?.htmlLink ?? null,
        mapsLink: json?.mapsLink ?? null,
        location: json?.location ?? (location.trim() || null),
        startISO: json?.start ?? start.toISOString(),
        title: title.trim(),
      });
    } catch (e: any) {
      toast.error(`Falha ao agendar: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleSendToContact = async () => {
    if (!onSendToContact) return;
    setSendingLink(true);
    try {
      await onSendToContact(shareText);
      toast.success("Link enviado no WhatsApp");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao enviar: ${e?.message ?? String(e)}`);
    } finally {
      setSendingLink(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4" />
            {created ? "Compartilhar compromisso" : "Agendar compromisso"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "Evento criado. Compartilhe os detalhes com o cliente."
              : "Cria o evento no Google Agenda de jehahn38@gmail.com."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <Textarea rows={7} readOnly value={shareText} className="text-sm" />
            {created.htmlLink && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(created.htmlLink!, "_blank", "noopener,noreferrer")}
              >
                Abrir no Google Agenda
              </Button>
            )}
            {created.mapsLink && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(created.mapsLink!, "_blank", "noopener,noreferrer")}
              >
                <MapPin className="size-4" />
                Ver local no Maps
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evt-title">Título</Label>
              <Input
                id="evt-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="evt-when">Data e hora</Label>
                <Input
                  id="evt-when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evt-duration">Duração</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="evt-duration">
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

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="evt-reminder">Lembrete automático no WhatsApp</Label>
                <Select value={reminderMinutes} onValueChange={setReminderMinutes}>
                  <SelectTrigger id="evt-reminder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sem lembrete</SelectItem>
                    <SelectItem value="30">30 minutos antes</SelectItem>
                    <SelectItem value="60">1 hora antes</SelectItem>
                    <SelectItem value="120">2 horas antes</SelectItem>
                    <SelectItem value="1440">1 dia antes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reminderMinutes !== "0" && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--ww-accent,#25d366)]"
                      checked={remindClient}
                      onChange={(e) => setRemindClient(e.target.checked)}
                    />
                    Avisar o cliente ({contactPhone})
                  </label>
                  <div className="space-y-1.5">
                    <Label htmlFor="evt-owner-phone">Meu WhatsApp (lembrete para mim)</Label>
                    <Input
                      id="evt-owner-phone"
                      inputMode="tel"
                      placeholder="5551999999999"
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>



            <div className="space-y-1.5">
              <Label htmlFor="evt-location" className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                Local (endereço do cliente)
              </Label>
              <Input
                id="evt-location"
                placeholder="Ex.: Rua José de Carli, 640 — Chapecó/SC"
                value={location}
                maxLength={300}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="evt-desc">Descrição</Label>
              <Textarea
                id="evt-desc"
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button variant="outline" onClick={handleCopy}>
                <Copy className="size-4" />
                Copiar
              </Button>
              {onSendToContact && (
                <Button onClick={handleSendToContact} disabled={sendingLink}>
                  {sendingLink ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Enviar ao cliente
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Agendar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

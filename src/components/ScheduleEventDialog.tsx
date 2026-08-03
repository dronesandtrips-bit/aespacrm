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
import { CalendarPlus, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
  /** fetch já autenticado (mesmo helper usado nas demais chamadas da inbox) */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

// Valor inicial para <input type="datetime-local"> — próxima hora cheia.
function defaultLocalDateTime(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleEventDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
  authFetch,
}: Props) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultLocalDateTime());
  const [duration, setDuration] = useState("60");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const conversationLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/inbox`;
  }, []);

  useEffect(() => {
    if (!open) return;
    setTitle(`Compromisso — ${contactName}`);
    setWhen(defaultLocalDateTime());
    setDuration("60");
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
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        }),
      });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? res.statusText);
      }
      toast.success("Compromisso criado no Google Agenda", {
        action: json?.htmlLink
          ? {
              label: "Abrir",
              onClick: () => window.open(json.htmlLink, "_blank", "noopener,noreferrer"),
            }
          : undefined,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao agendar: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-4" />
            Agendar compromisso
          </DialogTitle>
          <DialogDescription>
            Cria o evento no Google Agenda de jehahn38@gmail.com.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

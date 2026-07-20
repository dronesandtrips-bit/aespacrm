import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Send,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Users,
  Clock,
  Paperclip,
  X,
  CalendarClock,
  Pause,
  Play,
  Square,
  Ban,
  CalendarDays,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  contactsDb,
  categoriesDb,
  bulkSendsDb,
  type BulkSend,
  type Contact,
  type Category,
} from "@/lib/db";
import { getSupabaseClient } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/disparos")({
  component: DisparosPage,
});

function statusBadge(s: BulkSend["status"]) {
  if (s === "completed")
    return (
      <Badge variant="outline" className="border-success text-success gap-1">
        <CheckCircle2 className="size-3" /> Completo
      </Badge>
    );
  if (s === "in_progress")
    return (
      <Badge variant="outline" className="border-accent text-accent gap-1">
        <Loader2 className="size-3 animate-spin" /> Enviando
      </Badge>
    );
  if (s === "scheduled")
    return (
      <Badge variant="outline" className="border-primary text-primary gap-1">
        <CalendarClock className="size-3" /> Agendado
      </Badge>
    );
  if (s === "paused")
    return (
      <Badge variant="outline" className="gap-1">
        <Pause className="size-3" /> Pausado
      </Badge>
    );
  if (s === "cancelled")
    return (
      <Badge variant="outline" className="border-muted-foreground text-muted-foreground gap-1">
        <Ban className="size-3" /> Cancelado
      </Badge>
    );
  if (s === "error")
    return (
      <Badge variant="outline" className="border-destructive text-destructive gap-1">
        <AlertCircle className="size-3" /> Erro
      </Badge>
    );
  return <Badge variant="secondary">Pendente</Badge>;
}

const VARIABLES: Array<{ key: string; desc: string }> = [
  { key: "{nome}", desc: "Nome completo" },
  { key: "{primeiro_nome}", desc: "Primeiro nome" },
  { key: "{empresa}", desc: "Notas/empresa do contato" },
  { key: "{categoria}", desc: "Categoria principal" },
  { key: "{link_descadastro}", desc: "Link p/ descadastrar (inserido auto. se omitido)" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function detectMediaType(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function DisparosPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<BulkSend[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("Olá {primeiro_nome}, tudo bem?");
  const [interval, setInterval] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  // Mídia opcional
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<{
    file: File;
    base64: string;
    type: "image" | "video" | "audio" | "document";
  } | null>(null);

  // Agendamento opcional (datetime-local)
  const [scheduleAt, setScheduleAt] = useState("");

  const insertVar = (v: string) => setMessage((m) => `${m}${v}`);

  const [detail, setDetail] = useState<BulkSend | null>(null);

  const reuseDispatch = (b: BulkSend) => {
    setName(b.name);
    setMessage(b.message ?? "");
    setInterval(b.intervalSeconds ?? 3);
    setScheduleAt("");
    setMedia(null);
    const ids = (b.contactIds ?? []).filter((id) => contacts.some((c) => c.id === id));
    setSelected(new Set(ids));
    setDetail(null);
    if (b.hasMedia) {
      toast.info("Mídia anterior não pode ser reanexada automaticamente — anexe novamente se necessário.");
    } else if (ids.length === 0) {
      toast.info("Nenhum contato deste disparo foi encontrado na sua lista atual.");
    } else {
      toast.success(`Disparo carregado — ${ids.length} contatos pré-selecionados`);
    }
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const load = async () => {
    try {
      const [cs, cats, h] = await Promise.all([
        contactsDb.list(),
        categoriesDb.list(),
        bulkSendsDb.list(),
      ]);
      setContacts(cs);
      setCategories(cats);
      setHistory(h);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = window.setInterval(async () => {
      try { setHistory(await bulkSendsDb.list()); } catch { /* silencioso */ }
    }, 5000);
    return () => window.clearInterval(t);
  }, []);

  const toggle = (id: string) => {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };
  const selectByCategory = (catId: string) => {
    const ids = contacts
      .filter((c) =>
        (c.categoryIds && c.categoryIds.length
          ? c.categoryIds.includes(catId)
          : c.categoryId === catId),
      )
      .map((c) => c.id);
    setSelected((p) => {
      const n = new Set(p);
      ids.forEach((i) => n.add(i));
      return n;
    });
  };

  const previewMessage = useMemo(() => {
    const sample = contacts.find((c) => selected.has(c.id)) || contacts[0];
    if (!sample) return message;
    const cat = categories.find((k) => k.id === sample.categoryId);
    const rendered = message
      .replaceAll("{nome}", sample.name)
      .replaceAll("{primeiro_nome}", sample.name.split(" ")[0])
      .replaceAll("{empresa}", (sample.notes ?? "").trim() || sample.name)
      .replaceAll("{categoria}", cat?.name ?? "")
      .replaceAll("{link_descadastro}", "https://crm.aespa.com.br/u/…");
    const hasOptout = message.includes("{link_descadastro}") || message.includes("{{link_descadastro}}");
    if (!hasOptout) {
      return `${rendered}\n\n_Não quer mais receber? Clique aqui:_ https://crm.aespa.com.br/u/…`;
    }
    return rendered;
  }, [message, selected, contacts, categories]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 15 MB)");
      e.target.value = "";
      return;
    }
    try {
      const base64 = await fileToBase64(f);
      setMedia({ file: f, base64, type: detectMediaType(f.type || "") });
    } catch (err: any) {
      toast.error(`Falha ao ler arquivo: ${err.message ?? err}`);
    } finally {
      e.target.value = "";
    }
  };

  const handleDispatch = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao disparo");
    if (!message.trim() && !media) return toast.error("Escreva uma mensagem ou anexe mídia");
    if (selected.size === 0) return toast.error("Selecione ao menos 1 contato");

    let scheduledAtIso: string | null = null;
    if (scheduleAt) {
      const d = new Date(scheduleAt);
      if (isNaN(d.getTime())) return toast.error("Data/hora de agendamento inválida");
      if (d.getTime() < Date.now() + 30_000) {
        return toast.error("Agendamento deve ser pelo menos 30s no futuro");
      }
      scheduledAtIso = d.toISOString();
    }

    setSubmitting(true);
    try {
      const bulk = await bulkSendsDb.create({
        name: name.trim(),
        message: message.trim() || (media?.file.name ?? ""),
        intervalSeconds: interval,
        totalContacts: selected.size,
        scheduledAt: scheduledAtIso,
        contactIds: Array.from(selected),
        media: media
          ? {
              type: media.type,
              base64: media.base64,
              mime: media.file.type || null,
              filename: media.file.name,
              caption: message.trim() || null,
            }
          : null,
      });

      const c = await getSupabaseClient();
      const { data: sess } = (await c?.auth.getSession()) ?? { data: { session: null } };
      const token = sess?.session?.access_token;
      if (!token) throw new Error("sessão expirada — faça login novamente");

      const res = await fetch("/api/public/evolution/bulk-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bulkId: bulk.id,
          contactIds: Array.from(selected),
          message: message.trim() || (media?.file.name ?? "[mídia]"),
          intervalSeconds: interval,
          scheduledAt: scheduledAtIso,
          media: media
            ? {
                type: media.type,
                base64: media.base64,
                mime: media.file.type || undefined,
                filename: media.file.name,
                caption: message.trim() || undefined,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        await bulkSendsDb.update(bulk.id, { status: "error" });
        throw new Error(typeof data.error === "string" ? data.error : "falha ao iniciar disparo");
      }

      if (scheduledAtIso) {
        toast.success(`📅 Disparo agendado para ${new Date(scheduledAtIso).toLocaleString("pt-BR")}`);
      } else {
        toast.success(`🚀 Disparo iniciado para ${selected.size} contatos`);
      }
      setHistory(await bulkSendsDb.list());
      setName("");
      setSelected(new Set());
      setMedia(null);
      setScheduleAt("");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const setControl = async (b: BulkSend, control: "run" | "paused" | "cancelled") => {
    try {
      await bulkSendsDb.update(b.id, { control });
      const label =
        control === "paused" ? "Pausando…" :
        control === "run" ? "Retomando…" :
        "Cancelando…";
      toast.success(label);
      setHistory(await bulkSendsDb.list());
    } catch (e: any) {
      toast.error(`Falha: ${e.message ?? e}`);
    }
  };

  const removeBulk = async (b: BulkSend) => {
    if (!confirm(`Apagar o disparo "${b.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await bulkSendsDb.remove(b.id);
      toast.success("Disparo apagado");
      setDetail((d) => (d?.id === b.id ? null : d));
      setHistory(await bulkSendsDb.list());
    } catch (e: any) {
      toast.error(`Falha ao apagar: ${e.message ?? e}`);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 max-w-[1400px]">
      {/* Form principal */}
      <div className="space-y-5">
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Configurar disparo</h3>
            <p className="text-xs text-muted-foreground">
              Use variáveis para personalizar a mensagem
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn">Nome do disparo</Label>
            <Input
              id="dn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Promoção de fim de ano"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dm">Mensagem {media && <span className="text-xs text-muted-foreground">(legenda da mídia)</span>}</Label>
            <Textarea id="dm" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  title={v.desc}
                  className="px-2 py-0.5 rounded text-xs font-mono border bg-muted hover:bg-muted/70 transition"
                >
                  {v.key}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Prévia: <span className="text-foreground italic">"{previewMessage}"</span>
            </p>
          </div>

          {/* Mídia */}
          <div className="space-y-1.5">
            <Label>Mídia (opcional)</Label>
            {media ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Paperclip className="size-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{media.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {media.type} · {(media.file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setMedia(null)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                  onChange={onPickFile}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Paperclip className="size-4" /> Anexar arquivo (máx 15 MB)
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Intervalo entre envios</Label>
                <Badge variant="secondary" className="gap-1">
                  <Clock className="size-3" /> {interval}s
                </Badge>
              </div>
              <Slider value={[interval]} onValueChange={([v]) => setInterval(v)} min={1} max={60} step={1} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds" className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" /> Agendar (opcional)
              </Label>
              <Input
                id="ds"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              {scheduleAt && (
                <p className="text-xs text-muted-foreground">
                  Inicia em {new Date(scheduleAt).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Selecionar contatos</h3>
              <p className="text-xs text-muted-foreground">
                {selected.size} de {contacts.length} selecionados
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={toggleAll} disabled={contacts.length === 0}>
              {selected.size === contacts.length && contacts.length > 0 ? "Limpar" : "Selecionar todos"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => selectByCategory(c.id)}
                className="px-3 py-1 rounded-full text-xs font-medium border hover:bg-muted transition"
                style={{ borderColor: c.color, color: c.color }}
              >
                + {c.name}
              </button>
            ))}
          </div>

          <Separator className="my-3" />

          <div className="mb-3">
            <Input
              placeholder="Buscar contato por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum contato. Importe ou crie contatos antes de disparar.
            </div>
          ) : (() => {
            const q = search.trim().toLowerCase();
            const filtered = contacts.filter((c) => {
              if (selected.has(c.id)) return true;
              if (q) {
                return (
                  c.name.toLowerCase().includes(q) ||
                  c.phone.toLowerCase().includes(q)
                );
              }
              return false;
            });
            if (filtered.length === 0) {
              return (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Pesquise um contato acima ou clique em uma TAG para listar.
                </div>
              );
            }
            return (
            <div className="max-h-[320px] overflow-auto space-y-1">
              {filtered.map((c) => {
                const cat = categories.find((k) => k.id === c.categoryId);
                const checked = selected.has(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                    <div
                      className="size-8 rounded-full grid place-items-center text-white text-xs font-semibold"
                      style={{ backgroundColor: cat?.color ?? "#94a3b8" }}
                    >
                      {c.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate font-mono">{c.phone}</p>
                    </div>
                    {cat && (
                      <Badge variant="outline" style={{ borderColor: cat.color, color: cat.color }}>
                        {cat.name}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
            );
          })()}
        </Card>

        <div className="flex justify-end gap-2">
          {selected.size > 0 && (
            <Button size="lg" variant="outline" onClick={() => setSelected(new Set())} className="gap-2">
              <X className="size-4" /> Limpar seleção
            </Button>
          )}
          <Button size="lg" onClick={handleDispatch} className="gap-2" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> :
             scheduleAt ? <CalendarClock className="size-4" /> : <Send className="size-4" />}
            {scheduleAt ? "Agendar para" : "Disparar para"} {selected.size} contatos
          </Button>
        </div>
      </div>

      {/* Histórico */}
      <Card className="p-5 h-fit xl:sticky xl:top-6">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="size-4 text-primary" /> Disparos recentes
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Últimos 20 · atualiza a cada 5s</p>
        <div className="space-y-3 max-h-[600px] overflow-auto">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum disparo ainda</p>
          )}
          {history.slice(0, 20).map((b) => {
            const pct = b.totalContacts > 0 ? Math.round((b.sentCount / b.totalContacts) * 100) : 0;
            const canPause = b.status === "in_progress" && b.control !== "paused";
            const canResume = b.status === "paused" || b.control === "paused";
            const canCancel = ["scheduled", "in_progress", "paused"].includes(b.status);
            const canDelete = ["cancelled", "error", "completed"].includes(b.status);
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(b)}
                onKeyDown={(e) => { if (e.key === "Enter") setDetail(b); }}
                className="border rounded-lg p-3 space-y-2 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.scheduledAt && b.status === "scheduled"
                        ? `⏰ ${new Date(b.scheduledAt).toLocaleString("pt-BR")}`
                        : new Date(b.createdAt).toLocaleString("pt-BR")}
                    </p>
                    {b.hasMedia && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Paperclip className="size-3" /> {b.mediaType}
                      </p>
                    )}
                  </div>
                  {statusBadge(b.status)}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{b.sentCount} / {b.totalContacts}</span>
                    <span className="font-medium">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {(canPause || canResume || canCancel || canDelete) && (
                  <div className="flex gap-1 pt-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    {canPause && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setControl(b, "paused")}>
                        <Pause className="size-3" /> Pausar
                      </Button>
                    )}
                    {canResume && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setControl(b, "run")}>
                        <Play className="size-3" /> Retomar
                      </Button>
                    )}
                    {canCancel && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive" onClick={() => setControl(b, "cancelled")}>
                        <Square className="size-3" /> Cancelar
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive" onClick={() => removeBulk(b)}>
                        <Trash2 className="size-3" /> Apagar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Dialog de detalhes do disparo */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          {detail && (() => {
            const ids = detail.contactIds ?? [];
            const resolved = ids
              .map((id) => contacts.find((c) => c.id === id))
              .filter(Boolean) as Contact[];
            const missing = ids.length - resolved.length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 pr-8">
                    <span className="truncate">{detail.name}</span>
                    {statusBadge(detail.status)}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Criado em</p>
                      <p className="font-medium">{new Date(detail.createdAt).toLocaleString("pt-BR")}</p>
                    </div>
                    {detail.scheduledAt && (
                      <div>
                        <p className="text-muted-foreground">Agendado para</p>
                        <p className="font-medium">{new Date(detail.scheduledAt).toLocaleString("pt-BR")}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground">Intervalo</p>
                      <p className="font-medium">{detail.intervalSeconds}s</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Enviados</p>
                      <p className="font-medium">{detail.sentCount} / {detail.totalContacts}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Mensagem</p>
                    <div className="p-3 rounded-lg border bg-muted/30 whitespace-pre-wrap text-sm max-h-60 overflow-auto">
                      {detail.message || <span className="italic text-muted-foreground">(sem texto)</span>}
                    </div>
                  </div>

                  {detail.hasMedia && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Mídia anexada</p>
                      <div className="p-2 rounded-lg border bg-muted/30 flex items-center gap-2 text-xs">
                        <Paperclip className="size-3.5 text-primary" />
                        <span className="font-medium">{detail.mediaType}</span>
                        {detail.mediaFilename && <span className="text-muted-foreground truncate">· {detail.mediaFilename}</span>}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Contatos ({ids.length})
                      {missing > 0 && (
                        <span className="ml-1 text-amber-600">· {missing} não encontrado(s) na lista atual</span>
                      )}
                    </p>
                    <div className="max-h-48 overflow-auto border rounded-lg divide-y">
                      {ids.length === 0 && (
                        <p className="p-3 text-xs text-muted-foreground italic">Lista de contatos não disponível para este disparo.</p>
                      )}
                      {resolved.map((c) => (
                        <div key={c.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="font-mono text-muted-foreground">{c.phone}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
                  <Button onClick={() => reuseDispatch(detail)} className="gap-2">
                    <RotateCcw className="size-4" /> Reutilizar disparo
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

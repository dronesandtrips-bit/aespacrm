import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  GitBranch,
  Loader2,
  Play,
  Pause,
  Clock,
  Users,
  CalendarClock,
  GripVertical,
  Copy,
  Send,
  FileText,
  Sparkles,
} from "lucide-react";
import {
  sequencesDb,
  contactsDb,
  pipelineDb,
  templatesDb,
  type Sequence,
  type SequenceStep,
  type SequenceStepMetric,
  type MessageTemplate,
  type Contact,
  type ContactSequence,
  type PipelineStage,
} from "@/lib/db";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getSupabaseClient } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/sequencias")({
  component: SequenciasPage,
});

const MAX_STEPS = 10;
const DAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_FULL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatDays(days: number[]): string {
  if (!days || days.length === 0) return "Nenhum dia";
  if (days.length === 7) return "Todos os dias";
  const sorted = [...days].sort();
  const isWeekdays =
    sorted.length === 5 && sorted.every((d, i) => d === i + 1);
  if (isWeekdays) return "Seg–Sex";
  return sorted.map((d) => DAY_FULL[d]).join(", ");
}

type DraftStep = {
  uid: string;
  message: string;
  delayValue: number;
  delayUnit: "hours" | "days";
  typingSeconds: number;
};

let _uidCounter = 0;
const newUid = () => `s_${Date.now()}_${++_uidCounter}`;

function SequenciasPage() {
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Sequence | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setSeqs(await sequencesDb.list());
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="size-6 text-primary" /> Sequências
          </h1>
          <p className="text-sm text-muted-foreground">
            Follow-up automático: configure passos com delay e mensagens.
          </p>
        </div>
        <NewSequenceDialog onCreated={reload} />
      </div>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : seqs.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <GitBranch className="size-10 mx-auto opacity-30 mb-3" />
          <p>Nenhuma sequência criada ainda.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {seqs.map((s) => (
            <Card
              key={s.id}
              className="p-4 cursor-pointer hover:border-primary/40 transition"
              onClick={() => setSelected(s)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {s.name}
                    {s.isActive ? (
                      <Badge variant="default" className="text-[10px]">
                        <Play className="size-2.5 mr-1" /> ativa
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        <Pause className="size-2.5 mr-1" /> pausada
                      </Badge>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <CalendarClock className="size-3" />
                    {s.windowStartHour}h–{s.windowEndHour}h ·{" "}
                    {formatDays(s.windowDays)}
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  Editar passos
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <SequenceEditorDialog
          sequence={selected}
          onClose={() => setSelected(null)}
          onChange={reload}
        />
      )}
    </div>
  );
}

function NewSequenceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await sequencesDb.create({ name: name.trim(), description: desc.trim() || undefined });
      toast.success("Sequência criada");
      setName("");
      setDesc("");
      setOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4 mr-1" /> Nova sequência
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova sequência</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Boas-vindas" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="size-4 mr-1 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SequenceEditorDialog({
  sequence,
  onClose,
  onChange,
}: {
  sequence: Sequence;
  onClose: () => void;
  onChange: () => void;
}) {
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollIds, setEnrollIds] = useState<string[]>([]);
  const [enrollSearch, setEnrollSearch] = useState("");
  const [enrolled, setEnrolled] = useState<ContactSequence[]>([]);
  const [startHour, setStartHour] = useState<number>(sequence.windowStartHour);
  const [endHour, setEndHour] = useState<number>(sequence.windowEndHour);
  const [days, setDays] = useState<number[]>(sequence.windowDays);
  const [savingWindow, setSavingWindow] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [stopStageIds, setStopStageIds] = useState<string[]>(sequence.stopOnStageIds);
  const [autoResumeDays, setAutoResumeDays] = useState<number>(sequence.autoResumeAfterDays);
  const [savingRules, setSavingRules] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [metrics, setMetrics] = useState<SequenceStepMetric[]>([]);
  const [testingIdx, setTestingIdx] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reloadEnrolled = async () => {
    try {
      const all = await sequencesDb.listContactSequences();
      setEnrolled(all.filter((x) => x.sequenceId === sequence.id));
    } catch {
      /* silent */
    }
  };

  const reloadMetrics = async () => {
    try {
      setMetrics(await sequencesDb.stepMetrics(sequence.id));
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c, st, all, tpls, mets] = await Promise.all([
          sequencesDb.listSteps(sequence.id),
          contactsDb.list(),
          pipelineDb.listStages(),
          sequencesDb.listContactSequences(),
          templatesDb.list().catch(() => []),
          sequencesDb.stepMetrics(sequence.id).catch(() => []),
        ]);
        if (cancelled) return;
        setSteps(
          s.length > 0
            ? s.map((x: SequenceStep) => ({
                uid: newUid(),
                message: x.message,
                delayValue: x.delayValue,
                delayUnit: x.delayUnit,
                typingSeconds: x.typingSeconds ?? 0,
              }))
            : [{ uid: newUid(), message: "", delayValue: 1, delayUnit: "days", typingSeconds: 0 }],
        );
        setContacts(c);
        setStages(st);
        setEnrolled(all.filter((x) => x.sequenceId === sequence.id));
        setTemplates(tpls);
        setMetrics(mets);
      } catch (e: any) {
        toast.error(`Erro: ${e.message ?? e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequence.id]);

  const addStep = () => {
    if (steps.length >= MAX_STEPS) return;
    setSteps((p) => [...p, { uid: newUid(), message: "", delayValue: 1, delayUnit: "days", typingSeconds: 0 }]);
  };

  const removeStep = (i: number) => {
    setSteps((p) => p.filter((_, idx) => idx !== i));
  };

  const cloneStep = (i: number) => {
    if (steps.length >= MAX_STEPS) {
      toast.error(`Máximo de ${MAX_STEPS} passos`);
      return;
    }
    setSteps((p) => {
      const copy = { ...p[i], uid: newUid() };
      return [...p.slice(0, i + 1), copy, ...p.slice(i + 1)];
    });
  };

  const loadTemplate = (i: number, content: string) => {
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, message: content } : s)));
    toast.success("Template carregado");
  };

  const updateStep = (i: number, patch: Partial<DraftStep>) => {
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSteps((p) => {
      const oldIdx = p.findIndex((s) => s.uid === active.id);
      const newIdx = p.findIndex((s) => s.uid === over.id);
      if (oldIdx < 0 || newIdx < 0) return p;
      return arrayMove(p, oldIdx, newIdx);
    });
  };

  const sendTest = async (i: number) => {
    const step = steps[i];
    if (!step.message.trim()) {
      toast.error("Escreva a mensagem antes");
      return;
    }
    setTestingIdx(i);
    try {
      const c = await getSupabaseClient();
      if (!c) throw new Error("Supabase não configurado");
      const { data: sess } = await c.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) throw new Error("Não autenticado");
      const res = await fetch("/api/public/sequences/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          message: step.message,
          typing_seconds: step.typingSeconds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Falha (${res.status})`);
      }
      toast.success("Teste enviado");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setTestingIdx(null);
    }
  };

  const save = async () => {
    if (steps.some((s) => !s.message.trim())) {
      toast.error("Todos os passos precisam de mensagem");
      return;
    }
    setSaving(true);
    try {
      await sequencesDb.saveSteps(sequence.id, steps);
      toast.success("Passos salvos");
      await reloadMetrics();
      onChange();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    try {
      await sequencesDb.update(sequence.id, { isActive: !sequence.isActive });
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const removeSeq = async () => {
    if (!confirm("Excluir esta sequência?")) return;
    try {
      await sequencesDb.remove(sequence.id);
      toast.success("Excluída");
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const enrollMany = async () => {
    if (enrollIds.length === 0) return;
    setEnrolling(true);
    try {
      const r = await sequencesDb.enroll(sequence.id, enrollIds);
      toast.success(`${r.enrolled} contato(s) inscrito(s)`);
      setEnrollIds([]);
      setEnrollSearch("");
      await reloadEnrolled();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setEnrolling(false);
    }
  };

  const removeEnrolled = async (csId: string) => {
    if (!confirm("Remover este contato da sequência?")) return;
    try {
      await sequencesDb.removeContact(csId);
      toast.success("Removido");
      await reloadEnrolled();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const toggleEnrollId = (id: string) => {
    setEnrollIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  };

  const applyPreset = (preset: "weekdays" | "all" | "weekend") => {
    if (preset === "weekdays") setDays([1, 2, 3, 4, 5]);
    else if (preset === "all") setDays([0, 1, 2, 3, 4, 5, 6]);
    else setDays([0, 6]);
  };

  const saveWindow = async () => {
    if (startHour >= endHour) {
      toast.error("Hora inicial deve ser menor que a final");
      return;
    }
    if (days.length === 0) {
      toast.error("Selecione pelo menos um dia");
      return;
    }
    setSavingWindow(true);
    try {
      await sequencesDb.update(sequence.id, {
        windowStartHour: startHour,
        windowEndHour: endHour,
        windowDays: days,
      });
      toast.success("Janela atualizada");
      onChange();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSavingWindow(false);
    }
  };

  const windowDirty =
    startHour !== sequence.windowStartHour ||
    endHour !== sequence.windowEndHour ||
    JSON.stringify([...days].sort()) !==
      JSON.stringify([...sequence.windowDays].sort());

  const toggleStopStage = (id: string) => {
    setStopStageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await sequencesDb.update(sequence.id, {
        stopOnStageIds: stopStageIds,
        autoResumeAfterDays: autoResumeDays,
      });
      toast.success("Regras de auto-stop salvas");
      onChange();
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setSavingRules(false);
    }
  };

  const rulesDirty =
    autoResumeDays !== sequence.autoResumeAfterDays ||
    JSON.stringify([...stopStageIds].sort()) !==
      JSON.stringify([...sequence.stopOnStageIds].sort());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>{sequence.name}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleActive}>
                {sequence.isActive ? "Pausar" : "Ativar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={removeSeq}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="size-5 mx-auto animate-spin opacity-60" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              Variáveis disponíveis: <code>{"{{nome}}"}</code>, <code>{"{{empresa}}"}</code>
            </div>

            {steps.map((s, i) => (
              <Card key={i} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Clock className="size-3.5" /> Passo {i + 1}
                  </div>
                  {steps.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeStep(i)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <Label className="text-xs">Esperar</Label>
                    <Input
                      type="number"
                      min={0}
                      value={s.delayValue}
                      onChange={(e) =>
                        updateStep(i, { delayValue: Math.max(0, Number(e.target.value)) })
                      }
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unidade</Label>
                    <Select
                      value={s.delayUnit}
                      onValueChange={(v) => updateStep(i, { delayUnit: v as "hours" | "days" })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hours">horas</SelectItem>
                        <SelectItem value="days">dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Mensagem</Label>
                  <Textarea
                    value={s.message}
                    onChange={(e) => updateStep(i, { message: e.target.value })}
                    rows={3}
                    placeholder="Olá {{nome}}, tudo bem?"
                  />
                </div>
              </Card>
            ))}

            {steps.length < MAX_STEPS && (
              <Button variant="outline" size="sm" onClick={addStep} className="w-full">
                <Plus className="size-4 mr-1" /> Adicionar passo ({steps.length}/{MAX_STEPS})
              </Button>
            )}

            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-2">
                  <CalendarClock className="size-3.5" /> Janela de envio
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Horário de Brasília (UTC-3)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">De</Label>
                  <Select
                    value={String(startHour)}
                    onValueChange={(v) => setStartHour(Number(v))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                          {String(h).padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Até</Label>
                  <Select
                    value={String(endHour)}
                    onValueChange={(v) => setEndHour(Number(v))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {String(h).padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Dias da semana</Label>
                <div className="flex gap-1 mt-1">
                  {DAY_LABELS.map((label, d) => {
                    const active = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={
                          "size-8 rounded-md text-xs font-medium transition-colors border " +
                          (active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-input text-muted-foreground")
                        }
                        title={DAY_FULL[d]}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => applyPreset("weekdays")}
                  >
                    Seg–Sex
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => applyPreset("all")}
                  >
                    Todos
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => applyPreset("weekend")}
                  >
                    Fim de semana
                  </Button>
                </div>
              </div>

              {windowDirty && (
                <Button size="sm" onClick={saveWindow} disabled={savingWindow}>
                  {savingWindow && <Loader2 className="size-4 mr-1 animate-spin" />}
                  Salvar janela
                </Button>
              )}
            </Card>

            <Card className="p-3 space-y-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <Pause className="size-3.5" /> Auto-stop avançado
              </div>

              <div>
                <Label className="text-xs">Pausar quando contato entrar nestas etapas do pipeline</Label>
                {stages.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Nenhuma etapa configurada
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {stages.map((s) => {
                      const active = stopStageIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleStopStage(s.id)}
                          className={
                            "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border " +
                            (active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-input text-muted-foreground")
                          }
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">
                  Retomar automaticamente após resposta (dias)
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={autoResumeDays}
                    onChange={(e) =>
                      setAutoResumeDays(
                        Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                      )
                    }
                    className="w-24"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {autoResumeDays === 0
                      ? "desativado — pausa manual"
                      : `retoma após ${autoResumeDays} dia(s) sem resposta`}
                  </span>
                </div>
              </div>

              {rulesDirty && (
                <Button size="sm" onClick={saveRules} disabled={savingRules}>
                  {savingRules && <Loader2 className="size-4 mr-1 animate-spin" />}
                  Salvar regras
                </Button>
              )}
            </Card>

            <Card className="p-3 space-y-3 bg-muted/30">
              <div className="text-sm font-medium flex items-center gap-2">
                <Users className="size-3.5" /> Inscrever contatos
                {enrollIds.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {enrollIds.length} selecionado(s)
                  </Badge>
                )}
              </div>

              <Input
                placeholder="Buscar por nome ou telefone…"
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
              />

              <div className="max-h-56 overflow-auto rounded border bg-background divide-y">
                {(() => {
                  const enrolledIds = new Set(enrolled.map((e) => e.contactId));
                  const q = enrollSearch.trim().toLowerCase();
                  const filtered = contacts.filter((c) => {
                    if (enrolledIds.has(c.id)) return false;
                    if (!q) return true;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      c.phone.toLowerCase().includes(q)
                    );
                  });
                  if (filtered.length === 0) {
                    return (
                      <div className="p-3 text-xs text-muted-foreground text-center">
                        Nenhum contato disponível.
                      </div>
                    );
                  }
                  return filtered.map((c) => {
                    const checked = enrollIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleEnrollId(c.id)}
                        />
                        <span className="flex-1 truncate">
                          {c.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {c.phone}
                          </span>
                        </span>
                      </label>
                    );
                  });
                })()}
              </div>

              <div className="flex gap-2">
                {enrollIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEnrollIds([])}
                  >
                    Limpar
                  </Button>
                )}
                <Button
                  className="ml-auto"
                  onClick={enrollMany}
                  disabled={enrollIds.length === 0 || enrolling}
                >
                  {enrolling && <Loader2 className="size-4 mr-1 animate-spin" />}
                  Inscrever {enrollIds.length > 0 ? `(${enrollIds.length})` : ""}
                </Button>
              </div>
            </Card>

            <Card className="p-3 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Users className="size-3.5" /> Contatos inscritos
                <Badge variant="secondary" className="text-[10px]">
                  {enrolled.length}
                </Badge>
              </div>
              {enrolled.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  Nenhum contato inscrito ainda.
                </p>
              ) : (
                <div className="max-h-64 overflow-auto divide-y">
                  {enrolled.map((cs) => {
                    const ct = contacts.find((c) => c.id === cs.contactId);
                    const statusBadge =
                      cs.status === "active"
                        ? { label: "ativo", variant: "default" as const }
                        : cs.status === "paused"
                          ? { label: "pausado", variant: "secondary" as const }
                          : cs.status === "completed"
                            ? { label: "concluído", variant: "outline" as const }
                            : { label: "cancelado", variant: "outline" as const };
                    return (
                      <div
                        key={cs.id}
                        className="flex items-center gap-2 py-1.5 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            {ct ? ct.name : "(contato removido)"}
                            {ct && (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · {ct.phone}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            passo {cs.currentStep + 1}
                            {cs.nextSendAt && cs.status === "active"
                              ? ` · próx: ${new Date(cs.nextSendAt).toLocaleString("pt-BR")}`
                              : ""}
                          </div>
                        </div>
                        <Badge variant={statusBadge.variant} className="text-[10px]">
                          {statusBadge.label}
                        </Badge>
                        {cs.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Pausar"
                            onClick={async () => {
                              try {
                                await sequencesDb.pauseContact(cs.id, "manual");
                                await reloadEnrolled();
                              } catch (e: any) {
                                toast.error(`Erro: ${e.message ?? e}`);
                              }
                            }}
                          >
                            <Pause className="size-3.5" />
                          </Button>
                        ) : cs.status === "paused" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Retomar"
                            onClick={async () => {
                              try {
                                await sequencesDb.resumeContact(cs.id);
                                await reloadEnrolled();
                              } catch (e: any) {
                                toast.error(`Erro: ${e.message ?? e}`);
                              }
                            }}
                          >
                            <Play className="size-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Remover"
                          onClick={() => removeEnrolled(cs.id)}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="size-4 mr-1 animate-spin" />} Salvar passos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

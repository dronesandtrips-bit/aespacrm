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
} from "lucide-react";
import {
  sequencesDb,
  contactsDb,
  pipelineDb,
  type Sequence,
  type SequenceStep,
  type Contact,
  type PipelineStage,
} from "@/lib/db";
import { toast } from "sonner";

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

type DraftStep = { message: string; delayValue: number; delayUnit: "hours" | "days" };

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
  const [enrollContactId, setEnrollContactId] = useState<string>("");
  const [startHour, setStartHour] = useState<number>(sequence.windowStartHour);
  const [endHour, setEndHour] = useState<number>(sequence.windowEndHour);
  const [days, setDays] = useState<number[]>(sequence.windowDays);
  const [savingWindow, setSavingWindow] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [stopStageIds, setStopStageIds] = useState<string[]>(sequence.stopOnStageIds);
  const [autoResumeDays, setAutoResumeDays] = useState<number>(sequence.autoResumeAfterDays);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c, st] = await Promise.all([
          sequencesDb.listSteps(sequence.id),
          contactsDb.list(),
          pipelineDb.listStages(),
        ]);
        if (cancelled) return;
        setSteps(
          s.length > 0
            ? s.map((x: SequenceStep) => ({
                message: x.message,
                delayValue: x.delayValue,
                delayUnit: x.delayUnit,
              }))
            : [{ message: "", delayValue: 1, delayUnit: "days" }],
        );
        setContacts(c);
        setStages(st);
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
    setSteps((p) => [...p, { message: "", delayValue: 1, delayUnit: "days" }]);
  };

  const removeStep = (i: number) => {
    setSteps((p) => p.filter((_, idx) => idx !== i));
  };

  const updateStep = (i: number, patch: Partial<DraftStep>) => {
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
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

  const enrollOne = async () => {
    if (!enrollContactId) return;
    setEnrolling(true);
    try {
      const r = await sequencesDb.enroll(sequence.id, [enrollContactId]);
      toast.success(`${r.enrolled} contato(s) inscrito(s)`);
      setEnrollContactId("");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    } finally {
      setEnrolling(false);
    }
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

            <Card className="p-3 space-y-2 bg-muted/30">
              <div className="text-sm font-medium flex items-center gap-2">
                <Users className="size-3.5" /> Inscrever contato
              </div>
              <div className="flex gap-2">
                <Select value={enrollContactId} onValueChange={setEnrollContactId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Escolha um contato" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {c.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={enrollOne} disabled={!enrollContactId || enrolling}>
                  {enrolling && <Loader2 className="size-4 mr-1 animate-spin" />} Inscrever
                </Button>
              </div>
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

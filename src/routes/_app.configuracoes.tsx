import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, User, LogOut, GripVertical, Plug, Save, Loader2, Code2, Copy, ExternalLink, Sparkles } from "lucide-react";
import { categoriesDb, pipelineDb, sequencesDb, widgetsDb, type Category, type PipelineStage, type Sequence, type CaptureWidget } from "@/lib/db";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/_app/configuracoes")({
  component: SettingsPage,
});

const COLORS = [
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#EF4444",
  "#14B8A6",
  "#64748B",
];

function SettingsPage() {
  return (
    <div className="max-w-4xl">
      <Tabs defaultValue="categorias">
        <TabsList>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="widgets">Widgets</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="conta">Conta</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-5">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-5">
          <PipelineTab />
        </TabsContent>
        <TabsContent value="widgets" className="mt-5">
          <WidgetsTab />
        </TabsContent>
        <TabsContent value="integracoes" className="mt-5">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="conta" className="mt-5">
          <AccountTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const NO_SEQ = "__none__";

function SequenceSelect({
  value,
  onChange,
  sequences,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  sequences: Sequence[];
}) {
  return (
    <Select
      value={value ?? NO_SEQ}
      onValueChange={(v) => onChange(v === NO_SEQ ? null : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Nenhuma" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SEQ}>Nenhuma (sem gatilho automático)</SelectItem>
        {sequences.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} {s.isActive ? "" : "(pausada)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CategoriesTab() {
  const [list, setList] = useState<Category[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    try {
      const [cs, sqs] = await Promise.all([categoriesDb.list(), sequencesDb.list()]);
      setList(cs);
      setSequences(sqs);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, []);

  const save = async (name: string, color: string, sequenceId: string | null) => {
    if (!name.trim()) return toast.error("Nome obrigatório");
    try {
      if (editing) {
        await categoriesDb.update(editing.id, { name: name.trim(), color, sequenceId });
        toast.success("Categoria atualizada");
      } else {
        await categoriesDb.create(name.trim(), color, sequenceId);
        toast.success("Categoria criada");
      }
      await refresh();
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta categoria?")) return;
    try {
      await categoriesDb.remove(id);
      await refresh();
      toast.success("Removida");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Categorias de contatos</h3>
          <p className="text-xs text-muted-foreground">{loading ? "..." : `${list.length} categorias`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={seeding}
            onClick={seedDefaults}
            title="Cria 7 categorias padrão (pula nomes já existentes)"
          >
            {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Criar categorias padrão
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="size-4" /> Nova categoria
              </Button>
            </DialogTrigger>
            <CategoryDialog key={editing?.id ?? "new"} initial={editing} sequences={sequences} onSubmit={save} />
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : list.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma categoria. Crie a primeira para começar.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((c) => {
            const seq = sequences.find((s) => s.id === c.sequenceId);
            return (
              <div key={c.id} className="border rounded-lg p-3 flex items-center gap-3">
                <div
                  className="size-10 rounded-lg shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {seq ? `→ ${seq.name}` : "sem sequência"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CategoryDialog({
  initial,
  sequences,
  onSubmit,
}: {
  initial: Category | null;
  sequences: Sequence[];
  onSubmit: (name: string, color: string, sequenceId: string | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [sequenceId, setSequenceId] = useState<string | null>(initial?.sequenceId ?? null);
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar categoria" : "Nova categoria"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(name, color, sequenceId); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cn">Nome</Label>
          <Input id="cn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Cor</Label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "size-8 rounded-lg border-2 transition",
                  color === c ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Sequência automática</Label>
          <SequenceSelect value={sequenceId} onChange={setSequenceId} sequences={sequences} />
          <p className="text-[11px] text-muted-foreground">
            Quando um contato receber esta categoria, será inscrito automaticamente.
          </p>
        </div>
        <DialogFooter>
          <Button type="submit">Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function PipelineTab() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PipelineStage | null>(null);
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const refresh = async () => {
    try {
      const [st, sqs] = await Promise.all([pipelineDb.listStages(), sequencesDb.list()]);
      setStages(st);
      setSequences(sqs);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, []);

  const save = async (name: string, color: string, sequenceId: string | null) => {
    if (!name.trim()) return toast.error("Nome obrigatório");
    try {
      if (editing) {
        await pipelineDb.updateStage(editing.id, { name: name.trim(), color, sequenceId });
        toast.success("Etapa atualizada");
      } else {
        await pipelineDb.createStage(name.trim(), color, sequenceId);
        toast.success("Etapa criada");
      }
      await refresh();
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta etapa?")) return;
    try {
      const result = await pipelineDb.deleteStage(id);
      if (!result.ok) {
        toast.error(result.reason ?? "Não foi possível remover");
        return;
      }
      await refresh();
      toast.success("Etapa removida");
    } catch (e: any) {
      toast.error(`Erro: ${e.message ?? e}`);
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    const next = arrayMove(stages, oldIndex, newIndex);
    setStages(next);
    try {
      await pipelineDb.reorderStages(next.map((s) => s.id));
      toast.success("Ordem atualizada");
    } catch (e: any) {
      toast.error(`Erro ao reordenar: ${e.message ?? e}`);
      await refresh();
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Etapas do pipeline</h3>
          <p className="text-xs text-muted-foreground">
            Arraste para reordenar · {loading ? "..." : `${stages.length} etapas`}
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> Nova etapa
            </Button>
          </DialogTrigger>
          <StageDialog key={editing?.id ?? "new"} initial={editing} sequences={sequences} onSubmit={save} />
        </Dialog>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="size-6 mx-auto animate-spin opacity-60" />
        </div>
      ) : stages.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma etapa. Crie a primeira para configurar seu Kanban.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {stages.map((s) => (
                <SortableStageRow
                  key={s.id}
                  stage={s}
                  sequenceName={sequences.find((sq) => sq.id === s.sequenceId)?.name ?? null}
                  onEdit={() => { setEditing(s); setOpen(true); }}
                  onDelete={() => remove(s.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}

function SortableStageRow({
  stage,
  sequenceName,
  onEdit,
  onDelete,
}: {
  stage: PipelineStage;
  sequenceName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="border rounded-lg p-3 flex items-center gap-3 bg-card">
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label="Arrastar"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{stage.name}</p>
        {sequenceName && (
          <p className="text-[11px] text-muted-foreground truncate">→ {sequenceName}</p>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete}>
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}

function StageDialog({
  initial,
  sequences,
  onSubmit,
}: {
  initial: PipelineStage | null;
  sequences: Sequence[];
  onSubmit: (name: string, color: string, sequenceId: string | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [sequenceId, setSequenceId] = useState<string | null>(initial?.sequenceId ?? null);
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar etapa" : "Nova etapa"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(name, color, sequenceId); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sn">Nome</Label>
          <Input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Negociação" />
        </div>
        <div className="space-y-2">
          <Label>Cor</Label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "size-8 rounded-lg border-2 transition",
                  color === c ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Sequência automática</Label>
          <SequenceSelect value={sequenceId} onChange={setSequenceId} sequences={sequences} />
          <p className="text-[11px] text-muted-foreground">
            Quando um contato for movido para esta etapa, será inscrito automaticamente.
          </p>
        </div>
        <DialogFooter>
          <Button type="submit">Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function AccountTab() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="size-16 rounded-full bg-primary/10 grid place-items-center text-primary text-2xl font-bold">
          {user?.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="font-semibold">{user?.name}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 pt-2">
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input value={user?.name ?? ""} readOnly />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user?.email ?? ""} readOnly />
        </div>
      </div>
      <div className="pt-2 flex gap-2">
        <Button variant="outline" disabled className="gap-2">
          <User className="size-4" /> Editar perfil
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            logout();
            navigate({ to: "/login" });
          }}
          className="gap-2"
        >
          <LogOut className="size-4" /> Sair da conta
        </Button>
      </div>
    </Card>
  );
}

const EXPLORAR_WEBHOOK_KEY = "wpp-crm-explorar-webhook";
const EXPLORAR_API_KEY_KEY = "wpp-crm-explorar-webhook-apikey";

function IntegrationsTab() {
  const [webhook, setWebhook] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(EXPLORAR_WEBHOOK_KEY) ?? "";
  });
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(EXPLORAR_API_KEY_KEY) ?? "";
  });

  const save = () => {
    const v = webhook.trim();
    if (v && !/^https?:\/\//i.test(v)) {
      toast.error("URL inválida (use http:// ou https://)");
      return;
    }
    localStorage.setItem(EXPLORAR_WEBHOOK_KEY, v);
    localStorage.setItem(EXPLORAR_API_KEY_KEY, apiKey.trim());
    toast.success("Integração salva");
  };

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <Plug className="size-5" />
        </div>
        <div>
          <h3 className="font-semibold">Extração de Leads (n8n)</h3>
          <p className="text-xs text-muted-foreground">URL do Webhook usada pelo módulo Explorar</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="webhook">Webhook URL</Label>
        <Input
          id="webhook"
          placeholder="https://seu-n8n.com/webhook/zapcrm-extrair-leads"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          O endpoint receberá um POST com{" "}
          <code className="font-mono">{`{ niche, location }`}</code> e deve responder com uma lista de leads.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apikey">API Key (header X-API-Key)</Label>
        <Input
          id="apikey"
          type="password"
          placeholder="Cole aqui a chave do webhook"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Enviada no header <code className="font-mono">X-API-Key</code> para autenticar a chamada no n8n.
        </p>
      </div>

      <div>
        <Button onClick={save} className="gap-2">
          <Save className="size-4" /> Salvar
        </Button>
      </div>
    </Card>
  );
}

// =====================================================================
// Widgets de Captura
// =====================================================================
function WidgetsTab() {
  const [widgets, setWidgets] = useState<CaptureWidget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CaptureWidget | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [w, c, s] = await Promise.all([
        widgetsDb.list(),
        categoriesDb.list(),
        pipelineDb.listStages(),
      ]);
      setWidgets(w);
      setCategories(c);
      setStages(s);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar widgets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Excluir este widget? O código embedado parará de funcionar.")) return;
    try {
      await widgetsDb.remove(id);
      toast.success("Widget excluído");
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir");
    }
  }

  async function handleToggle(w: CaptureWidget) {
    try {
      await widgetsDb.update(w.id, { isActive: !w.isActive });
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Code2 className="size-4" /> Widgets de Captura
          </h3>
          <p className="text-sm text-muted-foreground">
            Gere um formulário embedável. Cada lead capturado cai direto no Pipeline.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="size-4" /> Novo widget
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : widgets.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
          Nenhum widget criado. Clique em <strong>Novo widget</strong> para começar.
        </div>
      ) : (
        <div className="space-y-2">
          {widgets.map((w) => (
            <WidgetRow
              key={w.id}
              widget={w}
              categories={categories}
              stages={stages}
              onEdit={() => {
                setEditing(w);
                setOpen(true);
              }}
              onDelete={() => handleDelete(w.id)}
              onToggle={() => handleToggle(w)}
            />
          ))}
        </div>
      )}

      <WidgetDialog
        open={open}
        onOpenChange={setOpen}
        widget={editing}
        categories={categories}
        stages={stages}
        onSaved={() => {
          setOpen(false);
          reload();
        }}
      />
    </Card>
  );
}

function WidgetRow({
  widget,
  categories,
  stages,
  onEdit,
  onDelete,
  onToggle,
}: {
  widget: CaptureWidget;
  categories: Category[];
  stages: PipelineStage[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const cat = categories.find((c) => c.id === widget.categoryId);
  const stage = stages.find((s) => s.id === widget.stageId);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embed = `<script src="${origin}/api/public/widget/embed/${widget.id}.js" async></script>`;
  const formUrl = `${origin}/widget/form/${widget.id}`;

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{widget.name}</span>
            {!widget.isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                inativo
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {widget.submissionsCount} envios
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {cat && <span>Categoria: <strong>{cat.name}</strong></span>}
            {stage && <span>Etapa: <strong>{stage.name}</strong></span>}
            {!cat && !stage && <span>Sem destino configurado</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onToggle}>
            {widget.isActive ? "Desativar" : "Ativar"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} title="Editar">
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Excluir">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-xs">Cole no seu site (script)</Label>
          <div className="flex gap-2 mt-1">
            <Input readOnly value={embed} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => copy(embed, "Script")}>
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={formUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="size-3" /> Pré-visualizar formulário
          </a>
        </div>
      </div>
    </div>
  );
}

function WidgetDialog({
  open,
  onOpenChange,
  widget,
  categories,
  stages,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  widget: CaptureWidget | null;
  categories: Category[];
  stages: PipelineStage[];
  onSaved: () => void;
}) {
  const NONE = "__none__";
  const [name, setName] = useState("");
  const [title, setTitle] = useState("Fale com a gente");
  const [subtitle, setSubtitle] = useState("Preencha e retornaremos em breve.");
  const [buttonText, setButtonText] = useState("Enviar");
  const [primaryColor, setPrimaryColor] = useState("#10B981");
  const [successMessage, setSuccessMessage] = useState(
    "Recebemos sua mensagem! Entraremos em contato em breve.",
  );
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [stageId, setStageId] = useState<string>(NONE);
  const [sourceTag, setSourceTag] = useState("site");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (widget) {
      setName(widget.name);
      setTitle(widget.title);
      setSubtitle(widget.subtitle ?? "");
      setButtonText(widget.buttonText);
      setPrimaryColor(widget.primaryColor);
      setSuccessMessage(widget.successMessage);
      setCategoryId(widget.categoryId ?? NONE);
      setStageId(widget.stageId ?? NONE);
      setSourceTag(widget.sourceTag ?? "site");
    } else {
      setName("");
      setTitle("Fale com a gente");
      setSubtitle("Preencha e retornaremos em breve.");
      setButtonText("Enviar");
      setPrimaryColor("#10B981");
      setSuccessMessage("Recebemos sua mensagem! Entraremos em contato em breve.");
      setCategoryId(NONE);
      setStageId(NONE);
      setSourceTag("site");
    }
  }, [open, widget]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Dê um nome ao widget");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        title,
        subtitle: subtitle || null,
        buttonText,
        primaryColor,
        successMessage,
        categoryId: categoryId === NONE ? null : categoryId,
        stageId: stageId === NONE ? null : stageId,
        sourceTag: sourceTag.trim() || null,
      };
      if (widget) {
        await widgetsDb.update(widget.id, payload);
        toast.success("Widget atualizado");
      } else {
        await widgetsDb.create(payload);
        toast.success("Widget criado");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{widget ? "Editar widget" : "Novo widget"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome interno *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Site institucional" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria do contato</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhuma</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etapa do pipeline</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhuma</SelectItem>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Origem (tag)</Label>
            <Input value={sourceTag} onChange={(e) => setSourceTag(e.target.value)} placeholder="site, landing-promo, etc" />
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Aparência do form</p>
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Subtítulo</Label>
              <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Texto do botão</Label>
                <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
              </div>
              <div>
                <Label>Cor primária</Label>
                <div className="flex gap-2">
                  <Input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-16 p-1 h-9" />
                  <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="font-mono text-xs" />
                </div>
              </div>
            </div>
            <div>
              <Label>Mensagem de sucesso</Label>
              <Input value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {widget ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

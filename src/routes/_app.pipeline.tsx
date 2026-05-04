import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  contactsDb,
  categoriesDb,
  pipelineDb,
  type Contact,
  type Category,
  type PipelineStage,
  type PipelinePlacement,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import { GripVertical, Phone, Loader2, Sparkles, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

const STAGE_COLORS = [
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#EF4444",
  "#14B8A6",
  "#64748B",
];

function NewStageDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setColor(STAGE_COLORS[0]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    try {
      await pipelineDb.createStage(name.trim(), color, null);
      toast.success("Etapa criada");
      setOpen(false);
      reset();
      onCreated();
    } catch (err: any) {
      toast.error(`Erro: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="size-4" /> Nova etapa
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova etapa</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stage-name">Nome</Label>
            <Input
              id="stage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Negociação"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {STAGE_COLORS.map((c) => (
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
          <p className="text-[11px] text-muted-foreground">
            Para vincular uma sequência automática, edite em Configurações → Pipeline.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactCard({
  contact,
  category,
  dragging,
}: {
  contact: Contact;
  category?: Category;
  dragging?: boolean;
}) {
  const hasAi = !!contact.aiPersonaSummary || !!contact.urgencyLevel;
  const card = (
    <div
      className={cn(
        "bg-card border rounded-lg p-3 shadow-sm space-y-2 cursor-grab active:cursor-grabbing",
        dragging && "shadow-[var(--shadow-elegant)] rotate-2",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="font-medium text-sm truncate">
              {contact.name && contact.name !== contact.phone ? contact.name : "Sem nome"}
            </p>
            {hasAi && <Sparkles className="size-3 text-primary shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Phone className="size-3" /> {contact.phone}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {category && (
          <Badge
            variant="outline"
            className="text-[10px]"
            style={{ borderColor: category.color, color: category.color }}
          >
            {category.name}
          </Badge>
        )}
        {contact.urgencyLevel && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] gap-0.5",
              contact.urgencyLevel === "Alta"
                ? "border-red-500/50 text-red-600 dark:text-red-400"
                : contact.urgencyLevel === "Média"
                  ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
            )}
          >
            <AlertTriangle className="size-2.5" />
            {contact.urgencyLevel}
          </Badge>
        )}
      </div>
    </div>
  );
  if (!hasAi || dragging) return card;
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent side="right" className="w-72 text-xs space-y-2">
        <div className="flex items-center gap-1.5 text-primary">
          <Sparkles className="size-3.5" />
          <span className="font-semibold">Análise da IA</span>
        </div>
        {contact.urgencyLevel && (
          <p>
            <span className="text-muted-foreground">Urgência:</span>{" "}
            <strong>{contact.urgencyLevel}</strong>
          </p>
        )}
        {contact.aiPersonaSummary ? (
          <p className="leading-relaxed">{contact.aiPersonaSummary}</p>
        ) : (
          <p className="italic text-muted-foreground">Sem resumo</p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function DraggableCard({ contact, category }: { contact: Contact; category?: Category }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <ContactCard contact={contact} category={category} />
    </div>
  );
}

function StageColumn({
  stage,
  contacts,
  categories,
}: {
  stage: PipelineStage;
  contacts: Contact[];
  categories: Category[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl bg-muted/40 border min-w-[260px] w-[260px] transition-colors",
        isOver && "bg-primary/5 border-primary",
      )}
    >
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <h4 className="font-semibold text-sm">{stage.name}</h4>
        </div>
        <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
      </div>
      <div className="p-2 space-y-2 flex-1 overflow-auto max-h-[calc(100vh-300px)]">
        {contacts.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            Arraste contatos aqui
          </div>
        ) : (
          contacts.map((c) => (
            <DraggableCard
              key={c.id}
              contact={c}
              category={categories.find((cat) => cat.id === c.categoryId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PipelinePage() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [placement, setPlacement] = useState<PipelinePlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    try {
      const [s, c, cats, p] = await Promise.all([
        pipelineDb.listStages(),
        contactsDb.list(),
        categoriesDb.list(),
        pipelineDb.listPlacements(),
      ]);
      setStages(s);
      setAllContacts(c);
      setCategories(cats);
      setPlacement(p);
    } catch (e: any) {
      toast.error(`Erro ao carregar: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  const grouped = stages.map((s) => ({
    stage: s,
    contacts: placement
      .filter((p) => p.stageId === s.id)
      .map((p) => allContacts.find((c) => c.id === p.contactId))
      .filter((c): c is Contact => !!c),
  }));

  // Contatos sem etapa (para mostrar e poder arrastar pra primeira coluna)
  const placedIds = new Set(placement.map((p) => p.contactId));
  const unplaced = allContacts.filter((c) => !placedIds.has(c.id));
  if (unplaced.length > 0 && stages.length > 0) {
    grouped[0] = {
      stage: grouped[0].stage,
      contacts: [...unplaced, ...grouped[0].contacts],
    };
  }

  const total = allContacts.length || 1;

  const handleStart = (e: DragStartEvent) => setActiveId(e.active.id as string);
  const handleEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id as string | undefined;
    const contactId = e.active.id as string;
    if (!overId) return;
    // Optimistic update
    const previous = placement;
    const next = previous.find((p) => p.contactId === contactId)
      ? previous.map((p) => (p.contactId === contactId ? { ...p, stageId: overId } : p))
      : [...previous, { contactId, stageId: overId }];
    setPlacement(next);
    try {
      await pipelineDb.moveContactToStage(contactId, overId);
      const stage = stages.find((s) => s.id === overId);
      toast.success(`Movido para ${stage?.name}`);
    } catch (err: any) {
      setPlacement(previous);
      toast.error(`Erro: ${err.message ?? err}`);
    }
  };

  const activeContact = activeId ? allContacts.find((c) => c.id === activeId) : null;

  if (loading) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Loader2 className="size-6 mx-auto mb-2 animate-spin opacity-60" />
        <p className="text-sm">Carregando pipeline...</p>
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground max-w-2xl">
        <p className="mb-2 font-medium text-foreground">Nenhuma etapa configurada</p>
        <p>Vá em Configurações → Pipeline para criar suas etapas.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {grouped.map(({ stage, contacts }) => (
            <StageColumn key={stage.id} stage={stage} contacts={contacts} categories={categories} />
          ))}
        </div>
        <DragOverlay>
          {activeContact && (
            <ContactCard
              contact={activeContact}
              category={categories.find((c) => c.id === activeContact.categoryId)}
              dragging
            />
          )}
        </DragOverlay>
      </DndContext>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {grouped.map(({ stage, contacts }) => {
          const pct = Math.round((contacts.length / total) * 100);
          return (
            <Card key={stage.id} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="text-xs text-muted-foreground truncate">{stage.name}</p>
              </div>
              <p className="text-2xl font-bold">{contacts.length}</p>
              <p className="text-xs text-muted-foreground">{pct}% do total</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

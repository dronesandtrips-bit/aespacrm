import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { GripVertical, Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

function ContactCard({
  contact,
  category,
  dragging,
}: {
  contact: Contact;
  category?: Category;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-3 shadow-sm space-y-2 cursor-grab active:cursor-grabbing",
        dragging && "shadow-[var(--shadow-elegant)] rotate-2",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{contact.name}</p>
          <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Phone className="size-3" /> {contact.phone}
          </p>
        </div>
      </div>
      {category && (
        <Badge
          variant="outline"
          className="text-[10px]"
          style={{ borderColor: category.color, color: category.color }}
        >
          {category.name}
        </Badge>
      )}
    </div>
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

  const total = placement.length || 1;

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

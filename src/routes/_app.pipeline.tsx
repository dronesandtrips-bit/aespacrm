import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { db, type Contact, type PipelineStage } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { GripVertical, Phone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

function ContactCard({ contact, dragging }: { contact: Contact; dragging?: boolean }) {
  const cat = db.listCategories().find((c) => c.id === contact.categoryId);
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
      {cat && (
        <Badge
          variant="outline"
          className="text-[10px]"
          style={{ borderColor: cat.color, color: cat.color }}
        >
          {cat.name}
        </Badge>
      )}
    </div>
  );
}

function DraggableCard({ contact }: { contact: Contact }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: contact.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <ContactCard contact={contact} />
    </div>
  );
}

function StageColumn({
  stage,
  contacts,
}: {
  stage: PipelineStage;
  contacts: Contact[];
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
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          <h4 className="font-semibold text-sm">{stage.name}</h4>
        </div>
        <Badge variant="secondary" className="text-xs">
          {contacts.length}
        </Badge>
      </div>
      <div className="p-2 space-y-2 flex-1 overflow-auto max-h-[calc(100vh-300px)]">
        {contacts.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            Arraste contatos aqui
          </div>
        ) : (
          contacts.map((c) => <DraggableCard key={c.id} contact={c} />)
        )}
      </div>
    </div>
  );
}

function PipelinePage() {
  const stages = useMemo(() => db.listStages(), []);
  const allContacts = useMemo(() => db.listContacts(), []);
  const [placement, setPlacement] = useState(() => db.listPipeline());
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = stages.map((s) => ({
    stage: s,
    contacts: placement
      .filter((p) => p.stageId === s.id)
      .map((p) => allContacts.find((c) => c.id === p.contactId))
      .filter((c): c is Contact => !!c),
  }));

  const total = placement.length || 1;

  const handleStart = (e: DragStartEvent) => setActiveId(e.active.id as string);
  const handleEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id as string | undefined;
    const contactId = e.active.id as string;
    if (!overId) return;
    db.moveContactToStage(contactId, overId);
    setPlacement([...db.listPipeline()]);
    const stage = stages.find((s) => s.id === overId);
    toast.success(`Movido para ${stage?.name}`);
  };

  const activeContact = activeId ? allContacts.find((c) => c.id === activeId) : null;

  return (
    <div className="space-y-5 max-w-[1400px]">
      <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {grouped.map(({ stage, contacts }) => (
            <StageColumn key={stage.id} stage={stage} contacts={contacts} />
          ))}
        </div>
        <DragOverlay>
          {activeContact && <ContactCard contact={activeContact} dragging />}
        </DragOverlay>
      </DndContext>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {grouped.map(({ stage, contacts }) => {
          const pct = Math.round((contacts.length / total) * 100);
          return (
            <Card key={stage.id} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
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

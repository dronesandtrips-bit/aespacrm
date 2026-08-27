// Visão semanal (grade por hora) da Agenda — aditiva.
// Renderiza os MESMOS eventos já carregados pela página; não faz requisições.
// Clique num horário vazio => criar; arrastar um bloco => reagendar.
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type WeekEvent = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  pending?: boolean;
};

const DAY_MS = 86_400_000;
const START_HOUR = 6;
const END_HOUR = 22;
const PX_PER_MIN = 0.9; // 54px por hora
const SNAP_MIN = 15;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Positioned = {
  ev: WeekEvent;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  startMin: number;
  endMin: number;
};

function layout(dayEvents: WeekEvent[]): Positioned[] {
  const items = dayEvents
    .map((ev) => {
      const s = new Date(ev.start!);
      const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 60 * 60_000);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = Math.max(startMin + 20, e.getHours() * 60 + e.getMinutes() || 24 * 60);
      return { ev, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin);

  // agrupa sobreposições em "clusters" e distribui em colunas
  const out: Positioned[] = [];
  let cluster: typeof items = [];
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.endMin);
      } else laneEnds[lane] = it.endMin;
      laneOf.set(it.ev.id, lane);
    }
    for (const it of cluster) {
      out.push({
        ev: it.ev,
        startMin: it.startMin,
        endMin: it.endMin,
        top: (it.startMin - START_HOUR * 60) * PX_PER_MIN,
        height: Math.max(22, (it.endMin - it.startMin) * PX_PER_MIN - 2),
        lane: laneOf.get(it.ev.id) ?? 0,
        lanes: laneEnds.length,
      });
    }
    cluster = [];
  };
  let clusterEnd = -1;
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

export function AgendaWeekView({
  events,
  onCreateAt,
  onOpen,
  onMove,
  movingId,
}: {
  events: WeekEvent[];
  onCreateAt: (date: Date) => void;
  onOpen: (ev: WeekEvent) => void;
  onMove: (ev: WeekEvent, newStart: Date) => void;
  movingId?: string | null;
}) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const dragId = useRef<string | null>(null);
  const dragOffsetMin = useRef(0);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(anchor.getTime() + i * DAY_MS)),
    [anchor],
  );

  const timed = useMemo(() => events.filter((e) => e.start && !e.allDay), [events]);
  const allDay = useMemo(() => events.filter((e) => e.start && e.allDay), [events]);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const gridHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;

  const rangeLabel = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${days[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;

  const minutesFromEvent = (e: React.MouseEvent | React.DragEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const raw = START_HOUR * 60 + y / PX_PER_MIN;
    return Math.max(0, Math.round(raw / SNAP_MIN) * SNAP_MIN);
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Semana anterior"
            onClick={() => setAnchor(new Date(anchor.getTime() - 7 * DAY_MS))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(startOfWeek(new Date()))}>
            Hoje
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Próxima semana"
            onClick={() => setAnchor(new Date(anchor.getTime() + 7 * DAY_MS))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="text-sm font-medium">{rangeLabel}</div>
      </div>

      {/* Cabeçalho dos dias */}
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
        <div />
        {days.map((d) => {
          const today = sameDay(d, new Date());
          return (
            <div key={d.toISOString()} className="border-l border-border px-1 py-1.5 text-center">
              <div className="text-[11px] text-muted-foreground">{WEEKDAYS[d.getDay()]}</div>
              <div
                className={
                  today
                    ? "mx-auto flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                    : "text-xs font-semibold"
                }
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dia inteiro */}
      {allDay.some((e) => days.some((d) => sameDay(new Date(e.start!), d))) && (
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
          <div className="px-1 py-1 text-right text-[10px] text-muted-foreground">dia todo</div>
          {days.map((d) => (
            <div key={d.toISOString()} className="space-y-1 border-l border-border p-1">
              {allDay
                .filter((e) => sameDay(new Date(e.start!), d))
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    className="block w-full truncate rounded bg-primary/15 px-1 py-0.5 text-left text-[11px] text-foreground"
                  >
                    {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Grade */}
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          {/* coluna de horas */}
          <div style={{ height: gridHeight }} className="relative">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[11px] text-muted-foreground"
                style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayEvents = timed.filter((e) => sameDay(new Date(e.start!), d));
            const positioned = layout(dayEvents);
            return (
              <div
                key={d.toISOString()}
                className="relative border-l border-border"
                style={{ height: gridHeight }}
                onClick={(e) => {
                  const min = minutesFromEvent(e, e.currentTarget);
                  const date = new Date(d);
                  date.setHours(0, min, 0, 0);
                  onCreateAt(date);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId.current;
                  if (!id) return;
                  const ev = timed.find((x) => x.id === id);
                  dragId.current = null;
                  if (!ev) return;
                  const min = minutesFromEvent(e, e.currentTarget) - dragOffsetMin.current;
                  const date = new Date(d);
                  date.setHours(0, Math.max(0, Math.round(min / SNAP_MIN) * SNAP_MIN), 0, 0);
                  if (date.getTime() !== new Date(ev.start!).getTime()) onMove(ev, date);
                }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                    style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
                  />
                ))}

                {positioned.map((p) => {
                  const widthPct = 100 / p.lanes;
                  const busy = movingId === p.ev.id;
                  return (
                    <button
                      key={p.ev.id}
                      draggable
                      onDragStart={(e) => {
                        dragId.current = p.ev.id;
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        dragOffsetMin.current = Math.round(
                          (e.clientY - rect.top) / PX_PER_MIN / SNAP_MIN,
                        ) * SNAP_MIN;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(p.ev);
                      }}
                      title={`${p.ev.title} — ${new Date(p.ev.start!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                      className={`absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] leading-tight ${
                        p.ev.pending
                          ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "border-primary/30 bg-primary/15 text-foreground"
                      } ${busy ? "opacity-50" : "hover:bg-primary/25"}`}
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `calc(${p.lane * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      <div className="font-medium">
                        {new Date(p.ev.start!).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="truncate">{p.ev.title}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

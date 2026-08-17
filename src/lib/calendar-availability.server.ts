// Consulta de disponibilidade no Google Agenda (freeBusy) — server only.
// Aditivo: usado pelo auto-book e pelo endpoint /api/public/calendar/availability.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

export type BusyBlock = { start: string; end: string };

function keys() {
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const connKey = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
  if (!lovableKey || !connKey) return null;
  return { lovableKey, connKey };
}

/** Blocos ocupados entre timeMin e timeMax. */
export async function getBusyBlocks(timeMin: string, timeMax: string): Promise<BusyBlock[]> {
  const k = keys();
  if (!k) throw new Error("Google Calendar não está conectado neste projeto");

  const res = await fetch(`${GATEWAY_URL}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${k.lovableKey}`,
      "X-Connection-Api-Key": k.connKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: "America/Sao_Paulo",
      items: [{ id: CALENDAR_ID }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[availability] freeBusy [${res.status}]: ${text}`);
    throw new Error(`Google Calendar [${res.status}]: ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  const busy = data?.calendars?.[CALENDAR_ID]?.busy ?? [];
  return busy.map((b: any) => ({ start: b.start, end: b.end }));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/** Verifica se o intervalo está livre; devolve os blocos conflitantes. */
export async function checkConflict(startISO: string, durationMinutes: number) {
  const start = new Date(startISO).getTime();
  const end = start + durationMinutes * 60_000;
  // Janela um pouco maior para pegar eventos que começam antes.
  const busy = await getBusyBlocks(
    new Date(start - 12 * 3_600_000).toISOString(),
    new Date(end + 12 * 3_600_000).toISOString(),
  );
  const conflicts = busy.filter((b) =>
    overlaps(start, end, new Date(b.start).getTime(), new Date(b.end).getTime()),
  );
  return { free: conflicts.length === 0, conflicts, busy };
}

export type SlotOptions = {
  fromISO?: string;
  days?: number;
  durationMinutes?: number;
  workStartHour?: number; // hora local SP
  workEndHour?: number;
  stepMinutes?: number;
  limit?: number;
  skipWeekends?: boolean;
  /** Horas preferidas (local SP). Padrão: 9h e depois 14h. */
  preferredHours?: number[];
  /** false = devolve também horários fora das horas preferidas (como fallback). */
  preferredOnly?: boolean;
};

/** Preferência do dono: manhã às 9h; se não der, 14h. */
export const DEFAULT_PREFERRED_HOURS = [9, 14];


const SP_OFFSET_MS = -3 * 3_600_000; // America/Sao_Paulo (UTC-3, sem horário de verão)

function spParts(ts: number) {
  const d = new Date(ts + SP_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), dow: d.getUTCDay() };
}

/** Sugere horários livres respeitando o expediente e os compromissos existentes. */
export async function findFreeSlots(opts: SlotOptions = {}) {
  const duration = opts.durationMinutes ?? 60;
  const days = Math.min(Math.max(opts.days ?? 7, 1), 60);
  const step = opts.stepMinutes ?? 30;
  const workStart = opts.workStartHour ?? 9;
  const workEnd = opts.workEndHour ?? 18;
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  const skipWeekends = opts.skipWeekends ?? true;

  const now = Date.now();
  let cursor = opts.fromISO ? new Date(opts.fromISO).getTime() : now + 60 * 60_000;
  if (Number.isNaN(cursor)) cursor = now + 60 * 60_000;
  if (cursor < now) cursor = now;
  // arredonda para o próximo múltiplo de `step`
  cursor = Math.ceil(cursor / (step * 60_000)) * step * 60_000;

  const timeMax = cursor + days * 86_400_000;
  const busy = await getBusyBlocks(new Date(cursor).toISOString(), new Date(timeMax).toISOString());
  const busyTs = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);

  const preferred = opts.preferredHours ?? DEFAULT_PREFERRED_HOURS;
  const preferredOnly = opts.preferredOnly ?? false;

  const preferredSlots: string[] = [];
  const otherSlots: string[] = [];
  for (let t = cursor; t + duration * 60_000 <= timeMax; t += step * 60_000) {
    const p = spParts(t);
    if (skipWeekends && (p.dow === 0 || p.dow === 6)) continue;
    const startMin = p.hour * 60 + p.minute;
    if (startMin < workStart * 60) continue;
    if (startMin + duration > workEnd * 60) continue;
    const end = t + duration * 60_000;
    if (busyTs.some(([bs, be]) => overlaps(t, end, bs, be))) continue;
    const iso = new Date(t).toISOString();
    if (p.minute === 0 && preferred.includes(p.hour)) preferredSlots.push(iso);
    else if (!preferredOnly) otherSlots.push(iso);
    if (preferredSlots.length >= limit) break;
  }

  // Ordem de preferência: 9h/14h primeiro (por data), depois os demais.
  const rank = (iso: string) => {
    const h = spParts(new Date(iso).getTime()).hour;
    const i = preferred.indexOf(h);
    return i === -1 ? preferred.length : i;
  };
  preferredSlots.sort((a, b) => {
    const d = new Date(a).setUTCHours(0, 0, 0, 0) - new Date(b).setUTCHours(0, 0, 0, 0);
    if (d !== 0) return d;
    return rank(a) - rank(b);
  });
  const slots = [...preferredSlots, ...otherSlots].slice(0, limit);
  return { slots, preferredSlots, busy };
}


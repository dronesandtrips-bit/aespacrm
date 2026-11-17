export const AGENDA_CONFIG_KEY = "AGENDA_CLOSURE_CONFIG";
export const AGENDA_EVENT_PREFIX = "AGENDA_CLOSURE_EVENT_";
export const AGENDA_DIGEST_PREFIX = "AGENDA_CLOSURE_DIGEST_";
export type ClosureStatus = "open" | "completed" | "reschedule" | "no_show" | "canceled";
export type ClosureEvent = {
  eventId: string; code: string; title: string; start: string; end: string;
  allDay: boolean; status: ClosureStatus; updatedAt: string;
};
export function spDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function digestDue(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour === 18;
}
export function ended(event: Pick<ClosureEvent, "end" | "allDay">, now: Date): boolean {
  // Google's date-only end is exclusive; never convert it through a timestamp.
  return event.allDay ? spDate(now) >= event.end : Date.parse(event.end) <= now.getTime();
}
export function unresolved(event: ClosureEvent, now: Date): boolean {
  return (event.status === "open" || event.status === "reschedule") && ended(event, now);
}
export function parseClosureReply(text: string): { code: string; status: ClosureStatus } | null {
  const match = text.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .match(/^AGENDA\s+([A-F0-9]{8})\s+(CONCLUIDO|SIM|REMARCAR|FALTA)$/);
  if (!match) return null;
  return { code: match[1].toLowerCase(), status: match[2] === "REMARCAR" ? "reschedule" : match[2] === "FALTA" ? "no_show" : "completed" };
}
export function closureDate(value: string, allDay = false): string {
  return allDay ? value.split("-").reverse().join("/") : new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}
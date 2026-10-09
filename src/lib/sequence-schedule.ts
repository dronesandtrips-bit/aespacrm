/** Browser-safe scheduling display; the database is authoritative for dispatch. */
export type WeeklyWindow = { windowDays: number[]; windowStartHour: number; windowEndHour: number };

export function nextWeeklyRound(window: WeeklyWindow, after = new Date(), activation?: string | null): Date | null {
  if (!window.windowDays.length || window.windowEndHour <= window.windowStartHour) return null;
  const threshold = Math.max(after.getTime(), activation ? new Date(activation).getTime() : 0);
  if (!Number.isFinite(threshold)) return null;
  const local = new Date(threshold - 3 * 3600_000);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset));
    if (!window.windowDays.includes(day.getUTCDay())) continue;
    const start = new Date(day.getTime() + (window.windowStartHour + 3) * 3600_000);
    if (start.getTime() >= threshold) return start;
  }
  return null;
}

export function formatWeeklyRound(date: Date | null): string {
  return date ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Sem dia disponível";
}

export function exceedsWindow(recipients: number, intervalSeconds: number, window: WeeklyWindow): boolean {
  return Math.max(0, recipients - 1) * intervalSeconds >= (window.windowEndHour - window.windowStartHour) * 3600;
}
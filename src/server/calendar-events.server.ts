import { z } from "zod";
export const CalendarRangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(120),
  past: z.coerce.number().int().min(0).max(365).default(90),
});
export async function calendarRequest(path: string, init?: RequestInit): Promise<any> {
  const key = process.env.LOVABLE_API_KEY?.trim();
  const connection = process.env.GOOGLE_CALENDAR_API_KEY?.trim();
  if (!key || !connection) throw new Error("Google Calendar não está conectado");
  const response = await fetch(`https://connector-gateway.lovable.dev/google_calendar/calendar/v3/calendars/primary${path}`, {
    ...init, headers: { Authorization: `Bearer ${key}`, "X-Connection-Api-Key": connection, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`Google Calendar [${response.status}]: ${text}`);
    throw new Error(`Google Calendar [${response.status}]: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}
export async function listCalendarEvents(days = 120, past = 90, now = new Date()): Promise<any[]> {
  CalendarRangeSchema.parse({ days, past });
  const qs = new URLSearchParams({ timeMin: new Date(now.getTime() - past * 86_400_000).toISOString(),
    timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const items: any[] = [];
  for (let page = 0; page < 40; page++) {
    const data = await calendarRequest(`/events?${qs}`);
    items.push(...(data.items ?? []));
    if (!data.nextPageToken) return items;
    qs.set("pageToken", data.nextPageToken);
  }
  throw new Error("Agenda excedeu 10.000 eventos; reduza o período de consulta. Nenhum histórico parcial foi exibido.");
}
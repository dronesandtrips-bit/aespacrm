import { afterEach, expect, test } from "bun:test";
import { listCalendarEvents } from "../src/server/calendar-events.server";
import { handleClosureReply, runAgendaDigest } from "../src/server/agenda-closure.server";
import { AGENDA_CONFIG_KEY, AGENDA_DIGEST_PREFIX, AGENDA_EVENT_PREFIX, type ClosureEvent } from "../src/lib/agenda-closure";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
// Store emulator enforces the real table's (user_id,name) unique key and CAS.
function store(initial: Record<string, string>) {
  const rows = new Map(Object.entries(initial));
  return { rows, from: (table: string) => {
    expect(table).toBe("crm_app_secrets");
    let op = "read", payload: any, filters: [string, any][] = [], prefix = "";
    const execute = () => {
      const name = filters.find(([key]) => key === "name")?.[1];
      if (op === "insert") {
        if (rows.has(payload.name)) return { error: { code: "23505" }, data: null };
        rows.set(payload.name, payload.value); return { error: null, data: null };
      }
      if (op === "update") {
        const expected = filters.find(([key]) => key === "value")?.[1];
        if (rows.get(name) !== expected) return { data: [], error: null };
        rows.set(name, payload.value); return { data: [{ name }], error: null };
      }
      if (name) return { data: rows.has(name) ? { value: rows.get(name) } : null, error: null };
      return { data: [...rows].filter(([key]) => !prefix || key.startsWith(prefix)).map(([name, value]) => ({ name, value })), error: null };
    };
    const q: any = { select: () => q, eq: (key: string, value: any) => { filters.push([key, value]); return q; },
      like: (_: string, value: string) => { prefix = value.slice(0, -1); return q; }, order: () => q, range: () => q,
      maybeSingle: async () => execute(), insert: (value: any) => { op = "insert"; payload = value; return q; },
      update: (value: any) => { op = "update"; payload = value; return q; }, then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject) };
    return q;
  } };
}
const now = new Date("2026-11-17T21:00:00Z");
const google = { id: "visit", summary: "Visita", start: { dateTime: "2026-11-17T12:00:00Z" }, end: { dateTime: "2026-11-17T13:00:00Z" } };
const tracked: ClosureEvent = { eventId: "visit", code: "a1b2c3d4", title: "Visita", start: google.start.dateTime, end: google.end.dateTime, allDay: false, status: "open", updatedAt: "" };
test("histórico de 90 dias busca todas as páginas de 250 eventos", async () => {
  let calls = 0;
  globalThis.fetch = (async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get("maxResults")).toBe("250");
    expect(url.searchParams.get("timeMin")).toBe("2026-08-19T21:00:00.000Z");
    calls++;
    return Response.json(calls === 1 ? { items: [{ id: "first" }], nextPageToken: "second" } : { items: [{ id: "last" }] });
  }) as typeof fetch;
  expect((await listCalendarEvents(120, 90, now)).map(e => e.id)).toEqual(["first", "last"]);
  expect(calls).toBe(2);
});
test("envia somente ao proprietário e não repete resultado ambíguo", async () => {
  const sb = store({ [AGENDA_CONFIG_KEY]: JSON.stringify({ enabled: true }), [`${AGENDA_EVENT_PREFIX}visit`]: JSON.stringify(tracked) });
  let sends = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("fetchInstances")) {
      expect(url).toContain("instanceName=zapcrm");
      return Response.json([{ name: "zapcrm", ownerJid: "5554991495959@s.whatsapp.net", connectionStatus: "open" }]);
    }
    if (url.includes("sendText")) {
      const body = JSON.parse(String(init?.body));
      expect(body.number).toBe("5554991495959");
      expect(url).toEndWith("/message/sendText/zapcrm");
      sends++; throw new Error("timeout após possível aceitação");
    }
    return Response.json({ items: [google] });
  }) as typeof fetch;
  const opts = { sb, userId: "owner", apiUrl: "https://evolution.example", apiKey: "test-only", now };
  expect((await runAgendaDigest(opts)).state).toBe("unresolved");
  expect((await runAgendaDigest(opts)).ran).toBe(false);
  expect(sends).toBe(1);
  expect(JSON.parse(sb.rows.get(`${AGENDA_DIGEST_PREFIX}2026-11-17`) ?? "{}").state).toBe("unresolved");
});
test("resposta de cliente nunca conclui compromisso do proprietário", async () => {
  const sb = store({ [`${AGENDA_EVENT_PREFIX}visit`]: JSON.stringify(tracked) });
  globalThis.fetch = (async () => Response.json([{ name: "zapcrm", ownerJid: "5554991495959@s.whatsapp.net", connectionStatus: "open" }])) as typeof fetch;
  expect(await handleClosureReply({ sb, userId: "owner", phone: "555484057527", text: "AGENDA A1B2C3D4 CONCLUIDO", apiUrl: "https://evolution.example", apiKey: "test-only" })).toBe(false);
  expect(JSON.parse(sb.rows.get(`${AGENDA_EVENT_PREFIX}visit`) ?? "{}").status).toBe("open");
});
test("resposta codificada do proprietário conclui e espelha no Google", async () => {
  const sb = store({ [`${AGENDA_EVENT_PREFIX}visit`]: JSON.stringify(tracked) });
  let patches = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes("fetchInstances")) return Response.json([{ name: "zapcrm", ownerJid: "5554991495959@s.whatsapp.net", connectionStatus: "open" }]);
    if (init?.method === "PATCH") { patches++; expect(JSON.parse(String(init.body)).summary).toBe("(concluído) Visita"); }
    return Response.json(google);
  }) as typeof fetch;
  expect(await handleClosureReply({ sb, userId: "owner", phone: "5554991495959", text: "AGENDA A1B2C3D4 CONCLUIDO", apiUrl: "https://evolution.example", apiKey: "test-only" })).toBe(true);
  expect(JSON.parse(sb.rows.get(`${AGENDA_EVENT_PREFIX}visit`) ?? "{}").status).toBe("completed");
  expect(patches).toBe(1);
});
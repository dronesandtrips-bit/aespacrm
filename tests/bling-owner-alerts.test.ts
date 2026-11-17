import { afterEach, expect, test } from "bun:test";
import { alertKind, BLING_ALERT_NOTICE, type ProposalTracking } from "../src/lib/bling-owner-alerts";
import { sendOwnerProposalNotice } from "../src/server/bling-owner-alerts.server";
const track: ProposalTracking = { proposalId: "550", numero: "550", nome: "Tais", contactId: "contact", sentAt: "2026-11-17T12:00:00Z" };
const activatedAt = "2026-11-17T00:00:00Z";
test("primeira resposta posterior ao lembrete gera aviso pessoal", () => {
  expect(alertKind(track, "2026-11-17T13:00:00Z", activatedAt, new Date("2026-11-17T13:01:00Z"))).toBe("reply");
  expect(alertKind(track, "2026-11-17T11:00:00Z", activatedAt, new Date("2026-11-17T13:01:00Z"))).toBeNull();
});
test("proposta estagnada somente cinco dias após primeiro lembrete", () => {
  expect(alertKind(track, null, activatedAt, new Date("2026-11-22T11:59:59Z"))).toBeNull();
  expect(alertKind(track, null, activatedAt, new Date("2026-11-22T12:00:00Z"))).toBe("stagnant");
});
test("resposta cancela aviso de estagnação", () => {
  expect(alertKind(track, "2026-11-18T12:00:00Z", activatedAt, new Date("2026-11-23T12:00:00Z"))).toBe("reply");
});
test("ativação não dispara histórico antigo", () => {
  const old = { ...track, sentAt: "2026-11-01T12:00:00Z" };
  expect(alertKind(old, null, activatedAt, new Date("2026-11-23T12:00:00Z"))).toBeNull();
  expect(alertKind(old, "2026-11-02T12:00:00Z", activatedAt, new Date("2026-11-23T12:00:00Z"))).toBeNull();
});
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
function store() {
  const rows = new Map<string, string>();
  return { rows, from(table: string) {
    expect(table).toBe("crm_app_secrets");
    let op = "read", payload: any, filters: [string, any][] = [];
    const execute = () => {
      expect(filters.find(([k]) => k === "user_id")?.[1] ?? payload?.user_id).toBe("owner");
      const name = filters.find(([k]) => k === "name")?.[1];
      if (op === "insert") {
        if (rows.has(payload.name)) return { error: { code: "23505" } };
        rows.set(payload.name, payload.value); return { error: null };
      }
      if (op === "update") {
        if (rows.get(name) !== filters.find(([k]) => k === "value")?.[1]) return { error: null, data: [] };
        rows.set(name, payload.value); return { error: null, data: [{ name }] };
      }
      return { error: null, data: rows.has(name) ? { value: rows.get(name) } : null };
    };
    const q: any = { select: () => q, eq: (k: string, v: any) => { filters.push([k, v]); return q; },
      insert: (v: any) => { op = "insert"; payload = v; return q; }, update: (v: any) => { op = "update"; payload = v; return q; },
      maybeSingle: async () => execute(), then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject) };
    return q;
  } };
}
test("somente proprietário recebe; timeout nunca gera reenvio", async () => {
  const sb = store(); let sends = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes("fetchInstances")) {
      expect(String(input)).toEndWith("?instanceName=zapcrm");
      return Response.json([{ name: "zapcrm", ownerJid: "5554991495959@s.whatsapp.net", connectionStatus: "open" }]);
    }
    expect(String(input)).toEndWith("/message/sendText/zapcrm");
    expect(JSON.parse(String(init?.body)).number).toBe("5554991495959");
    sends++; throw new Error("ambiguous timeout");
  }) as typeof fetch;
  const opts = { sb, userId: "owner", apiUrl: "https://example.test", apiKey: "test", track, kind: "reply" as const, now: new Date("2026-11-17T13:00:00Z") };
  expect(await sendOwnerProposalNotice(opts)).toBe("unresolved");
  expect(await sendOwnerProposalNotice(opts)).toBe("already_reserved");
  expect(sends).toBe(1);
  expect(JSON.parse(sb.rows.get(`${BLING_ALERT_NOTICE}550_reply`) ?? "{}").state).toBe("unresolved");
});
test("duas execuções simultâneas reservam apenas um aviso", async () => {
  const sb = store(); let sends = 0;
  globalThis.fetch = (async input => {
    if (String(input).includes("fetchInstances")) return Response.json([{ name: "zapcrm", ownerJid: "5554991495959@s.whatsapp.net", connectionStatus: "open" }]);
    sends++; return Response.json({ key: { id: "provider-id" } });
  }) as typeof fetch;
  const opts = { sb, userId: "owner", apiUrl: "https://example.test", apiKey: "test", track, kind: "stagnant" as const, now: new Date("2026-11-22T12:00:00Z") };
  const states = await Promise.all([sendOwnerProposalNotice(opts), sendOwnerProposalNotice(opts)]);
  expect(states.sort()).toEqual(["accepted", "already_reserved"]);
  expect(sends).toBe(1);
  expect(JSON.parse(sb.rows.get(`${BLING_ALERT_NOTICE}550_stagnant`) ?? "{}").messageId).toBe("provider-id");
});
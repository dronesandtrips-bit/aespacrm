import { describe, expect, test } from "bun:test";
import { digestDue, ended, parseClosureReply, unresolved, type ClosureEvent } from "../src/lib/agenda-closure";
const event: ClosureEvent = { eventId: "abc", code: "a1b2c3d4", title: "Visita", start: "2026-11-16T12:00:00Z", end: "2026-11-16T13:00:00Z", allDay: false, status: "open", updatedAt: "" };
describe("Fechamento da Agenda", () => {
  test("resumo somente às 18h de São Paulo", () => {
    expect(digestDue(new Date("2026-11-16T20:59:00Z"))).toBe(false);
    expect(digestDue(new Date("2026-11-16T21:00:00Z"))).toBe(true);
    expect(digestDue(new Date("2026-11-16T22:00:00Z"))).toBe(false);
  });
  test("pendente se repete nos dias seguintes até conclusão", () => {
    expect(unresolved(event, new Date("2026-11-17T21:00:00Z"))).toBe(true);
    expect(unresolved({ ...event, status: "completed" }, new Date("2026-11-17T21:00:00Z"))).toBe(false);
  });
  test("remarcar fica pendente até nova data, falta encerra", () => {
    expect(unresolved({ ...event, status: "reschedule" }, new Date("2026-11-17T21:00:00Z"))).toBe(true);
    expect(unresolved({ ...event, status: "no_show" }, new Date("2026-11-17T21:00:00Z"))).toBe(false);
  });
  test("não cobra evento antes do término", () => {
    expect(unresolved(event, new Date("2026-11-16T12:30:00Z"))).toBe(false);
  });
  test("resposta exige código, não confunde SIM do cliente", () => {
    expect(parseClosureReply("SIM")).toBeNull();
    expect(parseClosureReply("AGENDA A1B2C3D4 CONCLUÍDO")).toEqual({ code: "a1b2c3d4", status: "completed" });
    expect(parseClosureReply("AGENDA A1B2C3D4 REMARCAR")?.status).toBe("reschedule");
  });
  test("dia inteiro respeita fim exclusivo e data de São Paulo", () => {
    expect(ended({ end: "2026-11-17", allDay: true }, new Date("2026-11-17T01:00:00Z"))).toBe(false);
    expect(ended({ end: "2026-11-17", allDay: true }, new Date("2026-11-17T03:00:00Z"))).toBe(true);
  });
});
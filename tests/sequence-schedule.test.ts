import { describe, expect, test } from "bun:test";
import { nextWeeklyRound, exceedsWindow } from "../src/lib/sequence-schedule";
import { isDefinitiveInvalidNumber } from "../src/lib/sequence-dispatch-response";

const schedule = { windowDays: [1, 4], windowStartHour: 9, windowEndHour: 18 };
describe("Weekly sequence schedule", () => {
  test("Monday and Thursday repeat across consecutive weeks", () => {
    let after = new Date("2026-10-09T13:00:00Z");
    for (const expected of ["2026-10-12T12:00:00.000Z", "2026-10-15T12:00:00.000Z", "2026-10-19T12:00:00.000Z", "2026-10-22T12:00:00.000Z"]) {
      const next = nextWeeklyRound(schedule, after);
      expect(next?.toISOString()).toBe(expected);
      if (next) after = new Date(next.getTime() + 1);
    }
  });
  test("São Paulo timezone, month boundary, no past replay", () => {
    expect(nextWeeklyRound(schedule, new Date("2026-10-29T12:00:01Z"))?.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(nextWeeklyRound(schedule, new Date("2026-10-12T12:00:00Z"))?.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(nextWeeklyRound(schedule, new Date("2026-10-09T13:00:00Z"), "2026-10-15T13:00:00Z")?.toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });
  test("empty days and impossible windows do not schedule", () => {
    expect(nextWeeklyRound({ ...schedule, windowDays: [] })).toBeNull();
    expect(nextWeeklyRound({ ...schedule, windowEndHour: 8 })).toBeNull();
  });
  test("capacity excludes last send at closing hour", () => {
    expect(exceedsWindow(541, 60, schedule)).toBe(true);
    expect(exceedsWindow(540, 60, schedule)).toBe(false);
    expect(exceedsWindow(32, 70, schedule)).toBe(false);
  });
});

describe("Definitive invalid contacts versus uncertain sends", () => {
  test("400 and explicit exists:false allow skipping", () => {
    expect(isDefinitiveInvalidNumber({ ok: false, status: 400, error: { response: [{ exists: false }] } })).toBe(true);
    expect(isDefinitiveInvalidNumber({ ok: false, status: 400, error: '{"exists":false}' })).toBe(true);
  });
  test("timeouts, 5xx, unclassified 400 and successes never release claims", () => {
    for (const status of [500, 502, 504]) expect(isDefinitiveInvalidNumber({ ok: false, status, error: { exists: false } })).toBe(false);
    expect(isDefinitiveInvalidNumber({ ok: false, status: 400, error: { message: "unknown" } })).toBe(false);
    expect(isDefinitiveInvalidNumber({ ok: true, status: 200, error: { exists: false } })).toBe(false);
    expect(isDefinitiveInvalidNumber(null)).toBe(false);
  });
});
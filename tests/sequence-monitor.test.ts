import { describe, expect, it } from "bun:test";
import { canProceed, csvCell, dateBounds, logsCsv, pausedEnrollments, spDay, type MonitorEnrollment, type MonitorLog } from "../src/lib/sequence-monitor";
import { readAllPages } from "../src/hooks/use-sequence-monitor";

describe("Sequence monitoring (read-only)", () => {
  it("lists only paused enrollments and keeps reply pauses as a subset", () => {
    const rows = [
      { id: "manual", status: "paused", pause_reason: "manual" },
      { id: "reply", status: "paused", pause_reason: "inbound_reply" },
      { id: "active", status: "active", pause_reason: "inbound_reply" },
    ] as MonitorEnrollment[];
    expect(pausedEnrollments(rows).map(e => e.id)).toEqual(["manual", "reply"]);
    expect(pausedEnrollments(rows, "inbound_reply").map(e => e.id)).toEqual(["reply"]);
  });
  it("uses São Paulo calendar dates, including UTC midnight", () => {
    expect(spDay("2026-10-13T02:00:00Z")).toBe("2026-10-12");
    expect(dateBounds("2026-10-13", "2026-10-13")).toEqual({ since: "2026-10-13T03:00:00.000Z", until: "2026-10-14T03:00:00.000Z" });
  });
  it("exports safe quoted CSV, not spreadsheet formulas", () => {
    expect(csvCell('a;"b"')).toBe('"a;""b"""');
    expect(csvCell("+5511999999999")).toBe('"\'+5511999999999"');
    expect(csvCell(" =HYPERLINK(1)")).toBe('"\' =HYPERLINK(1)"');
    const log = { id: "l1", sent_at: "2026-10-13T12:00:00Z", step_order: 1, status: "sent", message: "Oi", error: null, occurrence_id: "round1", contact_sequences: null } as MonitorLog;
    expect(logsCsv([log])).toContain("Aceito pela API");
    expect(logsCsv([log])).toContain("round1");
  });
  it("preserves paused enrollments, exclusions and sequence pauses", () => {
    const enrollment = { status: "active", crm_contacts: { is_ignored: false } } as Parameters<typeof canProceed>[0];
    const sequence = { is_active: true } as Parameters<typeof canProceed>[1];
    expect(canProceed(enrollment, sequence)).toBe(true);
    expect(canProceed({ ...enrollment, status: "paused" } as typeof enrollment, sequence)).toBe(false);
    expect(canProceed(enrollment, { is_active: false } as typeof sequence)).toBe(false);
    expect(canProceed(undefined, sequence)).toBe(false);
  });
  it("reads all pages rather than silently truncating history", async () => {
    const calls: number[] = [];
    const rows = await readAllPages<number>(async (from) => { calls.push(from); return { data: from < 1000 ? Array.from({ length: 500 }, (_, i) => from + i) : [1000], error: null }; });
    expect(calls).toEqual([0, 500, 1000]);
    expect(rows.length).toBe(1001);
  });
  it("does not turn read failures into an empty success report", async () => {
    await expect(readAllPages(async () => ({ data: null, error: { message: "access denied" } }))).rejects.toThrow("access denied");
  });
});
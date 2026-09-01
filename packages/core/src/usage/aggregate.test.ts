import { describe, expect, it } from "vitest";
import { dayKey, sinceDaysAgo, summarise } from "./aggregate.js";
import { EMPTY_TOTALS, type UsageRecord } from "./transcripts.js";

const at = (iso: string) => Date.parse(iso);

function record(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    at: at("2026-09-01T10:00:00.000Z"),
    model: "claude-opus-5",
    sessionId: "s1",
    totals: { ...EMPTY_TOTALS, input: 10, output: 5 },
    ...over,
  };
}

describe("summarise", () => {
  it("returns an empty summary rather than throwing on no data", () => {
    const summary = summarise([]);
    expect(summary.requests).toBe(0);
    expect(summary.byDay).toEqual([]);
    expect(summary.from).toBeUndefined();
  });

  it("de-duplicates before grouping", () => {
    // Grouping raw records would count a repeat once per group, which is the
    // same overcount in a shape that is harder to spot.
    const rows = [record({ dedupeKey: "a" }), record({ dedupeKey: "a" }), record({ dedupeKey: "b" })];
    const summary = summarise(rows);
    expect(summary.requests).toBe(2);
    expect(summary.totals.input).toBe(20);
    expect(summary.byModel[0]!.requests).toBe(2);
  });

  it("counts sessions, not records", () => {
    const summary = summarise([
      record({ sessionId: "s1", dedupeKey: "1" }),
      record({ sessionId: "s1", dedupeKey: "2" }),
      record({ sessionId: "s2", dedupeKey: "3" }),
    ]);
    expect(summary.sessions).toBe(2);
  });

  it("does not merge the same session id across providers", () => {
    const summary = summarise([
      record({ sessionId: "shared", dedupeKey: "1" }),
      record({ sessionId: "shared", provider: "codex", dedupeKey: "2" }),
    ]);
    expect(summary.sessions).toBe(2);
  });

  it("orders days ascending and the rest by size", () => {
    const summary = summarise([
      record({ at: at("2026-09-03T10:00:00Z"), model: "small", totals: { ...EMPTY_TOTALS, output: 1 }, dedupeKey: "a" }),
      record({ at: at("2026-09-01T10:00:00Z"), model: "big", totals: { ...EMPTY_TOTALS, output: 99 }, dedupeKey: "b" }),
    ]);
    expect(summary.byDay.map((b) => b.key)).toEqual([...summary.byDay.map((b) => b.key)].sort());
    expect(summary.byModel[0]!.key).toBe("big");
  });

  it("honours a since cutoff", () => {
    const summary = summarise(
      [
        record({ at: at("2026-08-01T10:00:00Z"), dedupeKey: "old" }),
        record({ at: at("2026-09-01T10:00:00Z"), dedupeKey: "new" }),
      ],
      at("2026-08-15T00:00:00Z"),
    );
    expect(summary.requests).toBe(1);
  });

  it("reports the range actually found", () => {
    const summary = summarise([
      record({ at: at("2026-09-01T10:00:00Z"), dedupeKey: "a" }),
      record({ at: at("2026-09-05T10:00:00Z"), dedupeKey: "b" }),
    ]);
    expect(summary.from).toBe(at("2026-09-01T10:00:00Z"));
    expect(summary.to).toBe(at("2026-09-05T10:00:00Z"));
  });
});

describe("dayKey", () => {
  it("uses local time, so today means the user's today", () => {
    const noon = new Date(2026, 8, 1, 12, 0, 0).getTime();
    expect(dayKey(noon)).toBe("2026-09-01");
  });

  it("pads month and day so keys sort as strings", () => {
    expect(dayKey(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  });
});

describe("sinceDaysAgo", () => {
  it("counts today as the first day and starts at midnight", () => {
    const now = new Date(2026, 8, 10, 15, 30).getTime();
    expect(new Date(sinceDaysAgo(1, now)).getDate()).toBe(10);
    expect(new Date(sinceDaysAgo(1, now)).getHours()).toBe(0);
    expect(new Date(sinceDaysAgo(7, now)).getDate()).toBe(4);
  });
});

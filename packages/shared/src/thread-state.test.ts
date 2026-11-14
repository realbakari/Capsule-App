import { describe, expect, it } from "vitest";

import { summariseAttention } from "./attention.js";
import {
  isThreadUnread,
  nextWake,
  parseSnoozeUntil,
  parseThreadTriageAction,
  snoozePresets,
  threadShelf,
  unreadWatermark,
} from "./thread-state.js";
import type { Run, Session } from "./types.js";

const done = (at: string, status: Run["status"] = "completed") =>
  ({ status, completedAt: at, updatedAt: at }) as Pick<Run, "status" | "completedAt" | "updatedAt">;

describe("unread threads", () => {
  it("is unread when the latest turn finished after the last visit", () => {
    expect(isThreadUnread({ lastViewedAt: "2026-11-14T09:00:00.000Z" }, done("2026-11-14T10:00:00.000Z"))).toBe(true);
    expect(isThreadUnread({ lastViewedAt: "2026-11-14T11:00:00.000Z" }, done("2026-11-14T10:00:00.000Z"))).toBe(false);
  });

  it("counts a failed turn as news, but not one still running or cancelled", () => {
    expect(isThreadUnread({}, done("2026-11-14T10:00:00.000Z", "failed"))).toBe(true);
    expect(isThreadUnread({}, done("2026-11-14T10:00:00.000Z", "running"))).toBe(false);
    expect(isThreadUnread({}, done("2026-11-14T10:00:00.000Z", "cancelled"))).toBe(false);
  });

  it("marks unread to just before the latest turn finished", () => {
    const latest = done("2026-11-14T10:00:00.000Z");
    const watermark = unreadWatermark(latest)!;
    expect(isThreadUnread({ lastViewedAt: watermark }, latest)).toBe(true);
    expect(unreadWatermark(undefined)).toBeUndefined();
  });
});

describe("shelves", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");

  it("puts a future snooze ahead of settled, and a past one nowhere", () => {
    expect(threadShelf({ snoozedUntil: "2026-11-14T11:00:00.000Z", settledAt: "x" }, now)).toBe("snoozed");
    expect(threadShelf({ snoozedUntil: "2026-11-14T09:00:00.000Z" }, now)).toBe("active");
    expect(threadShelf({ settledAt: "2026-11-14T09:00:00.000Z" }, now)).toBe("settled");
  });

  it("aims one timer at the soonest active snooze", () => {
    const sessions = [
      { state: "active", snoozedUntil: "2026-11-14T12:00:00.000Z" },
      { state: "archived", snoozedUntil: "2026-11-14T10:30:00.000Z" },
      { state: "active", snoozedUntil: "2026-11-14T11:00:00.000Z" },
      { state: "active" },
    ] as Pick<Session, "state" | "snoozedUntil">[];
    expect(nextWake(sessions, now)).toBe(Date.parse("2026-11-14T11:00:00.000Z"));
  });

  it("keeps a decision visible on a snoozed thread and hides the rest", () => {
    const sessions = [
      { id: "a", title: "A", state: "active", snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() },
      { id: "b", title: "B", state: "active", settledAt: new Date().toISOString() },
      { id: "c", title: "C", state: "active", lastViewedAt: "2026-11-14T11:00:00.000Z" },
    ] as Session[];
    const runs = [
      { id: "1", sessionId: "a", status: "approval_required", createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z" },
      { id: "2", sessionId: "b", status: "completed", createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z" },
      { id: "3", sessionId: "c", status: "completed", createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z", completedAt: "2026-11-14T10:00:00.000Z" },
    ] as Run[];
    expect(summariseAttention({ sessions, runs }).items.map((item) => item.sessionId)).toEqual(["a"]);
  });
});

describe("snooze times", () => {
  it("offers presets in the future, at least an hour out", () => {
    const now = new Date(2026, 10, 14, 10, 20);
    const presets = snoozePresets(now);
    expect(presets.map((preset) => preset.id)).toEqual(["later-today", "this-evening", "tomorrow", "next-week"]);
    for (const preset of presets) expect(preset.at.getTime() - now.getTime()).toBeGreaterThanOrEqual(3_600_000);
    expect(presets.find((preset) => preset.id === "tomorrow")!.at.getHours()).toBe(9);
    expect(presets.find((preset) => preset.id === "next-week")!.at.getDay()).toBe(1);
  });

  it("drops today's presets late in the evening", () => {
    const presets = snoozePresets(new Date(2026, 10, 14, 22, 30));
    expect(presets.map((preset) => preset.id)).toEqual(["tomorrow", "next-week"]);
  });

  it("refuses the past and nonsense", () => {
    const now = Date.parse("2026-11-14T10:00:00.000Z");
    expect(() => parseSnoozeUntil("2026-11-14T09:00:00.000Z", now)).toThrow(/future/);
    expect(() => parseSnoozeUntil("soon", now)).toThrow(/valid/);
    expect(parseSnoozeUntil("2026-11-15T09:00:00.000Z", now)).toBe("2026-11-15T09:00:00.000Z");
  });
});

describe("the triage boundary", () => {
  it("accepts known actions and refuses the rest", () => {
    expect(parseThreadTriageAction({ kind: "settle" })).toEqual({ kind: "settle" });
    expect(parseThreadTriageAction({ kind: "snooze", until: "x" })).toEqual({ kind: "snooze", until: "x" });
    expect(() => parseThreadTriageAction({ kind: "snooze" })).toThrow();
    expect(() => parseThreadTriageAction({ kind: "delete" })).toThrow();
    expect(() => parseThreadTriageAction(undefined)).toThrow();
  });
});

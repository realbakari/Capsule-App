import { describe, expect, it } from "vitest";
import type { Run, Session } from "@capsule/shared";
import { formatWakeTime, nextTriageThread } from "./thread-triage";

const thread = (id: string, extra: Partial<Session> = {}): Session => ({
  id, title: id, projectId: "p", state: "active", updatedAt: "2026-11-14T10:00:00.000Z", lastViewedAt: "2026-11-14T09:00:00.000Z", ...extra,
} as Session);
const done = (status: Run["status"], at = "2026-11-14T10:00:00.000Z") => ({ status, completedAt: at, updatedAt: at });

describe("settle and next", () => {
  it("goes to a decision first, then unread news, never a shelf or the current thread", () => {
    const sessions = [thread("current"), thread("news"), thread("asks"), thread("snoozed", { snoozedUntil: "2999-01-01T00:00:00.000Z" }), thread("read", { lastViewedAt: "2026-11-14T11:00:00.000Z" })];
    const latest = new Map([
      ["current", done("completed")], ["news", done("completed")], ["asks", done("approval_required")],
      ["snoozed", done("completed")], ["read", done("completed")],
    ]);
    expect(nextTriageThread(sessions, latest, "current")?.id).toBe("asks");
    latest.set("asks", done("completed", "2026-11-14T08:00:00.000Z"));
    expect(nextTriageThread(sessions, latest, "current")?.id).toBe("news");
  });

  it("stays put when nothing is waiting", () => {
    expect(nextTriageThread([thread("current")], new Map(), "current")).toBeUndefined();
  });
});

describe("wake times", () => {
  it("names the day only when it is not today", () => {
    const now = new Date(2026, 10, 14, 10, 0);
    expect(formatWakeTime(new Date(2026, 10, 14, 18, 0).toISOString(), now, "24h")).toBe("18:00");
    expect(formatWakeTime(new Date(2026, 10, 15, 9, 0).toISOString(), now, "24h")).toBe("Tomorrow 09:00");
  });
});

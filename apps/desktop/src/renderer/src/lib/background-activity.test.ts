import { describe, expect, it } from "vitest";
import { backgroundNews } from "./background-activity";

describe("news from other threads", () => {
  it("reports transitions in other threads only", () => {
    const before = new Map([["r1", { status: "running" as const }], ["r2", { status: "running" as const }], ["r3", { status: "running" as const }]]);
    const now: Parameters<typeof backgroundNews>[1] = [
      { id: "r1", sessionId: "a", status: "completed" as const },
      { id: "r2", sessionId: "open", status: "completed" as const },
      { id: "r3", sessionId: "c", status: "approval_required" as const },
      { id: "r4", sessionId: "d", status: "failed" as const },
    ];
    expect(backgroundNews(before, now, "open", "2026-11-14T10:00:00.000Z")).toEqual([
      { runId: "r1", sessionId: "a", news: "finished" },
      { runId: "r3", sessionId: "c", news: "needs-approval" },
    ]);
  });

  it("ignores a stop and an unchanged run", () => {
    const before = new Map([["r1", { status: "running" as const }], ["r2", { status: "completed" as const }]]);
    expect(backgroundNews(before, [{ id: "r1", sessionId: "a", status: "cancelled" }, { id: "r2", sessionId: "b", status: "completed" }], undefined, "")).toEqual([]);
  });

  it("counts a run first seen finished only when it finished after the window opened", () => {
    const fresh = { id: "r9", sessionId: "a", status: "completed" as const, completedAt: "2026-11-14T10:00:05.000Z" };
    const old = { id: "r8", sessionId: "b", status: "completed" as const, completedAt: "2026-11-14T09:00:00.000Z" };
    expect(backgroundNews(new Map(), [fresh, old], undefined, "2026-11-14T10:00:00.000Z").map((item) => item.runId)).toEqual(["r9"]);
  });
});

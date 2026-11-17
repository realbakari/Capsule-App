import { describe, expect, it } from "vitest";
import { settledRuns } from "./background-activity";

describe("runs that settled between two snapshots", () => {
  it("reports a finish, a failure and a block, in any thread", () => {
    const before = new Map([["r1", { status: "running" as const }], ["r2", { status: "running" as const }], ["r3", { status: "approval_required" as const }], ["r4", { status: "running" as const }]]);
    const now = [
      { id: "r1", sessionId: "a", status: "completed" as const },
      { id: "r2", sessionId: "open", status: "failed" as const },
      { id: "r3", sessionId: "c", status: "blocked" as const },
      { id: "r4", sessionId: "d", status: "approval_required" as const },
    ];
    expect(settledRuns(before, now, "2026-11-14T10:00:00.000Z").map((run) => run.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("ignores a stop and an unchanged run", () => {
    const before = new Map([["r1", { status: "running" as const }], ["r2", { status: "completed" as const }]]);
    expect(settledRuns(before, [{ id: "r1", sessionId: "a", status: "cancelled" as const }, { id: "r2", sessionId: "b", status: "completed" as const }], "")).toEqual([]);
  });

  it("counts a run first seen finished only when it finished after the window opened", () => {
    const fresh = { id: "r9", sessionId: "a", status: "completed" as const, completedAt: "2026-11-14T10:00:05.000Z" };
    const old = { id: "r8", sessionId: "b", status: "completed" as const, completedAt: "2026-11-14T09:00:00.000Z" };
    expect(settledRuns(new Map(), [fresh, old], "2026-11-14T10:00:00.000Z").map((run) => run.id)).toEqual(["r9"]);
  });
});

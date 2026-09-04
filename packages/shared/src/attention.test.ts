import { describe, expect, it } from "vitest";

import { attentionLabel, summariseAttention } from "./attention.js";
import type { Run, Session } from "./types.js";

const session = (id: string, title: string, state: Session["state"] = "active") =>
  ({ id, title, state, workspaceId: "w", projectId: "p", agentId: "a", mode: "code" }) as Session;

const run = (sessionId: string, status: Run["status"], at = "2026-09-04T10:00:00Z") =>
  ({ id: `run-${sessionId}-${status}-${at}`, sessionId, status, createdAt: at, updatedAt: at }) as Run;

describe("which thread wants you first", () => {
  it("puts a decision ahead of everything else", () => {
    /*
     * A blocked turn is stopped, a finished one is news — but an approval is
     * the only state where nothing moves until a person acts.
     */
    const summary = summariseAttention({
      sessions: [session("a", "Running"), session("b", "Waiting"), session("c", "Broke"), session("d", "Done")],
      runs: [run("a", "running"), run("b", "approval_required"), run("c", "failed"), run("d", "completed")],
    });
    expect(summary.items.map((item) => item.state)).toEqual([
      "needs-input",
      "blocked",
      "ready",
      "running",
    ]);
    expect(summary.state).toBe("needs-input");
  });

  it("counts a thread once, however many runs it has", () => {
    const summary = summariseAttention({
      sessions: [session("a", "Busy")],
      runs: [run("a", "completed", "2026-09-04T10:00:00Z"), run("a", "completed", "2026-09-04T11:00:00Z")],
    });
    expect(summary.items).toHaveLength(1);
  });

  it("keeps the most urgent state when a thread is in several", () => {
    // A finished run does not cancel an approval sitting behind it.
    const summary = summariseAttention({
      sessions: [session("a", "Mixed")],
      runs: [run("a", "completed"), run("a", "approval_required")],
    });
    expect(summary.items[0]?.state).toBe("needs-input");
  });

  it("orders newest first inside a state", () => {
    const summary = summariseAttention({
      sessions: [session("a", "Older"), session("b", "Newer")],
      runs: [run("a", "completed", "2026-09-04T09:00:00Z"), run("b", "completed", "2026-09-04T12:00:00Z")],
    });
    expect(summary.items.map((item) => item.sessionId)).toEqual(["b", "a"]);
  });
});

describe("what is not waiting for you", () => {
  it("leaves out the thread you are looking at", () => {
    const summary = summariseAttention({
      sessions: [session("a", "On screen")],
      runs: [run("a", "completed")],
      activeSessionId: "a",
    });
    expect(summary.items).toHaveLength(0);
  });

  it("still surfaces an approval in the thread you are looking at", () => {
    // Being on screen is not the same as having been acted on.
    const summary = summariseAttention({
      sessions: [session("a", "On screen")],
      runs: [run("a", "approval_required")],
      activeSessionId: "a",
    });
    expect(summary.items[0]?.state).toBe("needs-input");
  });

  it("drops a finished thread once it has been seen", () => {
    const summary = summariseAttention({
      sessions: [session("a", "Read already")],
      runs: [run("a", "completed")],
      seenSessionIds: new Set(["a"]),
    });
    expect(summary.items).toHaveLength(0);
  });

  it("ignores archived threads and settled runs", () => {
    const summary = summariseAttention({
      sessions: [session("a", "Archived", "archived"), session("b", "Cancelled")],
      runs: [run("a", "approval_required"), run("b", "cancelled")],
    });
    expect(summary.items).toHaveLength(0);
    expect(summary.state).toBeUndefined();
  });
});

describe("the one line it can show", () => {
  it("leads with what needs a person", () => {
    const summary = summariseAttention({
      sessions: [session("a", "x"), session("b", "y"), session("c", "z")],
      runs: [run("a", "approval_required"), run("b", "failed"), run("c", "running")],
    });
    expect(attentionLabel(summary)).toBe("1 needs input · 1 blocked");
  });

  it("mentions running only when nothing else is waiting", () => {
    const summary = summariseAttention({
      sessions: [session("a", "x")],
      runs: [run("a", "running")],
    });
    expect(attentionLabel(summary)).toBe("1 running");
  });

  it("says nothing at all when nothing is waiting", () => {
    expect(attentionLabel(summariseAttention({ sessions: [], runs: [] }))).toBeUndefined();
  });
});

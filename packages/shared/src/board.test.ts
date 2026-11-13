import { describe, expect, it } from "vitest";

import {
  boardCardState,
  createsDependencyCycle,
  groupBoardCards,
  readBoardCardOp,
  readCreateBoardCard,
  readPendingStart,
  readyToAutoStart,
  type BoardContext,
  type BoardRun,
  type PendingStart,
} from "./board.js";
import type { Session } from "./types.js";

const card = (id: string, extra: Partial<Session> = {}): Session => ({
  id, title: id.toUpperCase(), state: "active", workspaceId: "w", projectId: "p", agentId: "a", mode: "code",
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...extra,
});
const draft = (dependsOn: string[] = [], autoStart = true): PendingStart => ({ prompt: "do it", dependsOn, autoStart, createdAt: "2026-11-01T00:00:00Z" });

function context(sessions: Session[], runs: Record<string, BoardRun> = {}, working: string[] = []): BoardContext {
  return {
    sessions: new Map(sessions.map((session) => [session.id, session])),
    latestRuns: new Map(Object.entries(runs)),
    isWorking: (session) => working.includes(session.id),
  };
}

describe("which column a card sits in", () => {
  it("keeps a draft with nothing to wait for in Draft", () => {
    const a = card("a", { pendingStart: draft() });
    expect(boardCardState(a, context([a]))).toEqual({ column: "draft" });
  });

  it("queues a draft behind a card that is not done yet, even one whose agent finished", () => {
    const a = card("a");
    const b = card("b", { pendingStart: draft(["a"]) });
    const ctx = context([a, b], { a: { status: "completed", hasResult: true } });
    expect(boardCardState(b, ctx)).toEqual({ column: "queued", waitingOn: ["a"] });
    expect(boardCardState(a, ctx)).toEqual({ column: "review" });
  });

  it("puts a draft whose prerequisites are all done back in Draft", () => {
    const a = card("a", { doneAt: "2026-11-02T00:00:00Z" });
    const b = card("b", { pendingStart: draft(["a"], false) });
    expect(boardCardState(b, context([a, b], { a: { status: "completed" } }))).toEqual({ column: "draft" });
    expect(boardCardState(a, context([a, b], { a: { status: "completed" } }))).toEqual({ column: "done" });
  });

  it("says a draft is blocked when what it waits for failed or was stopped", () => {
    const a = card("a");
    const c = card("c");
    const b = card("b", { pendingStart: draft(["a", "c"]) });
    const ctx = context([a, b, c], { a: { status: "failed", error: "boom" }, c: { status: "cancelled" } });
    expect(boardCardState(b, ctx)).toEqual({
      column: "needs-you",
      reason: "blocked",
      blockedBy: [{ id: "a", title: "A", status: "failed" }, { id: "c", title: "C", status: "cancelled" }],
    });
  });

  it("does not call a turn that answered, or failed only Capsule's own check, a failure", () => {
    const a = card("a");
    expect(boardCardState(a, context([a], { a: { status: "failed", hasResult: true } }))).toEqual({ column: "review" });
    expect(boardCardState(a, context([a], { a: { status: "failed", error: "Verification failed" } }))).toEqual({ column: "review" });
    expect(boardCardState(a, context([a], { a: { status: "failed", error: "spawn ENOENT" } }))).toEqual({ column: "needs-you", reason: "failed" });
  });

  it("reads approvals as Needs you and live turns as Running", () => {
    const a = card("a");
    expect(boardCardState(a, context([a], { a: { status: "approval_required" } }))).toEqual({ column: "needs-you", reason: "approval" });
    expect(boardCardState(a, context([a], { a: { status: "running" } }))).toEqual({ column: "running" });
    expect(boardCardState(a, context([a], { a: { status: "completed" } }, ["a"]))).toEqual({ column: "running" });
  });

  it("leaves out a thread with no turns and no prompt waiting", () => {
    const a = card("a");
    expect(boardCardState(a, context([a]))).toBeUndefined();
  });

  it("groups active cards into every column in order, archived ones left out", () => {
    const a = card("a", { pendingStart: draft() });
    const b = card("b", { state: "archived", pendingStart: draft() });
    const columns = groupBoardCards([a, b], context([a, b]));
    expect(columns.map((column) => column.id)).toEqual(["draft", "queued", "running", "needs-you", "review", "done"]);
    expect(columns[0]!.cards.map((item) => item.session.id)).toEqual(["a"]);
  });
});

describe("when a chained card starts on its own", () => {
  it("starts once every prerequisite is marked done, and not before", () => {
    const a = card("a");
    const b = card("b", { pendingStart: draft(["a"]) });
    expect(readyToAutoStart(b, context([a, b], { a: { status: "completed", hasResult: true } }))).toBe(false);
    const doneA = { ...a, doneAt: "2026-11-02T00:00:00Z" };
    expect(readyToAutoStart(b, context([doneA, b]))).toBe(true);
  });

  it("never starts a card that does not auto-start, has no prerequisites, or last failed to send", () => {
    const a = card("a", { doneAt: "x" });
    expect(readyToAutoStart(card("b", { pendingStart: draft(["a"], false) }), context([a]))).toBe(false);
    expect(readyToAutoStart(card("b", { pendingStart: draft([]) }), context([a]))).toBe(false);
    expect(readyToAutoStart(card("b", { pendingStart: { ...draft(["a"]), error: "busy" } }), context([a]))).toBe(false);
  });

  it("does not count a deleted prerequisite as done", () => {
    const b = card("b", { pendingStart: draft(["gone"]) });
    expect(readyToAutoStart(b, context([b]))).toBe(false);
    expect(boardCardState(b, context([b]))).toEqual({ column: "draft" });
  });
});

describe("linking cards", () => {
  it("refuses a link that would close a loop, including a card on itself", () => {
    const sessions = new Map([
      ["a", card("a", { pendingStart: draft([]) })],
      ["b", card("b", { pendingStart: draft(["a"]) })],
      ["c", card("c", { pendingStart: draft(["b"]) })],
    ]);
    expect(createsDependencyCycle(sessions, "a", "c")).toBe(true);
    expect(createsDependencyCycle(sessions, "a", "a")).toBe(true);
    expect(createsDependencyCycle(sessions, "c", "a")).toBe(false);
  });
});

describe("board input from another process", () => {
  it("accepts a well-formed card and drops duplicate links", () => {
    expect(readCreateBoardCard({ projectId: "p", prompt: "Fix it", dependsOn: ["a", "a"], autoStart: true, workspaceMode: "worktree", title: "  T " }))
      .toEqual({ projectId: "p", prompt: "Fix it", dependsOn: ["a"], autoStart: true, workspaceMode: "worktree", title: "T" });
  });

  it("refuses an empty prompt, a bad mode or a malformed link list", () => {
    expect(readCreateBoardCard({ projectId: "p", prompt: "  ", dependsOn: [] })).toBeUndefined();
    expect(readCreateBoardCard({ projectId: "p", prompt: "x", dependsOn: [], workspaceMode: "cloud" })).toBeUndefined();
    expect(readCreateBoardCard({ projectId: "p", prompt: "x", dependsOn: [3] })).toBeUndefined();
  });

  it("reads every card change and nothing else", () => {
    expect(readBoardCardOp({ type: "link", dependsOn: "a" })).toEqual({ type: "link", dependsOn: "a" });
    expect(readBoardCardOp({ type: "done" })).toEqual({ type: "done" });
    expect(readBoardCardOp({ type: "edit", autoStart: false })).toEqual({ type: "edit", autoStart: false });
    expect(readBoardCardOp({ type: "edit", prompt: "" })).toBeUndefined();
    expect(readBoardCardOp({ type: "delete" })).toBeUndefined();
  });

  it("reads a stored pending start and drops a corrupt one", () => {
    expect(readPendingStart(JSON.stringify(draft(["a", 4 as unknown as string])))).toEqual(draft(["a"]));
    expect(readPendingStart("{")).toBeUndefined();
    expect(readPendingStart(null)).toBeUndefined();
  });
});

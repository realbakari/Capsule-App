import { describe, expect, it } from "vitest";
import type { Run, Session } from "@capsule/shared";
import {
  compactRelativeTime,
  formatWorkingDurationLabel,
  resolveSidebarThreadKind,
  resolveProjectThreadKind,
  shouldRecedeThread,
  splitProjectThreads,
  groupSidebarThreads,
  latestSidebarRuns,
  readSidebarGrouping,
  visibleStatusThreads,
  indexSidebarThreads,
} from "./sidebar.js";

describe("cross-project status groups", () => {
  const projects = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
  const thread = (id: string, extra: Partial<Session> = {}): Session => ({
    id, title: id, projectId: "a", state: "active", updatedAt: "2026-09-01T00:00:00Z", ...extra,
  } as Session);
  const run = (sessionId: string, status: Run["status"], extra: Partial<Run> = {}): Run => ({
    id: `run-${sessionId}`, sessionId, status, createdAt: "2026-09-01T00:00:00Z", ...extra,
  } as Run);

  it("indexes active conversations by project without reordering pins", () => {
    const sessions = [thread("first"), thread("pin", { pinned: true }), thread("other", { projectId: "b" }), thread("old", { state: "archived" })];
    expect([...indexSidebarThreads(sessions)].map(([project, threads]) => [project, threads.map((item) => item.id)]))
      .toEqual([["a", ["first", "pin"]], ["b", ["other"]]]);
  });

  it("keeps an older selected conversation visible without expanding its entire project", () => {
    const threads = Array.from({ length: 50 }, (_, index) => thread(String(index), { updatedAt: new Date(Date.UTC(2026, 8, 28) - index * 86_400_000).toISOString() }));
    const result = splitProjectThreads(threads, () => "ready", 3, threads[49]);
    expect(result.rest.map((item) => item.id)).toEqual(["0", "1", "2", "49"]);
    expect(result.hidden).toBe(46);
  });

  it("classifies all projects once, retaining distinct failure and approval semantics", () => {
    const sessions = [thread("approval", { pinned: true, projectId: "b" }), thread("failed"), thread("queued"),
      thread("ready"), thread("empty"), thread("cancelled"), thread("idle", { harnessState: "waiting" }),
      thread("verdict"), thread("archived", { state: "archived" }), thread("orphan", { projectId: "missing" })];
    const latest = latestSidebarRuns([
      run("approval", "blocked"), run("failed", "failed", { error: "Agent exited" }), run("queued", "queued"),
      run("ready", "completed", { hasResult: true }), run("cancelled", "cancelled"),
      run("verdict", "failed", { error: "Verification failed" }),
    ]);
    const groups = groupSidebarThreads([...sessions, sessions[0]!], projects, latest);
    expect(groups.map((group) => [group.id, group.threads.map((item) => item.id)])).toEqual([
      ["attention", ["approval", "failed"]], ["working", ["queued"]], ["review", ["ready"]],
      ["other", ["cancelled", "empty", "idle", "verdict"]],
    ]);
    expect(groupSidebarThreads(sessions, projects, latest, " beta ")[0]?.threads.map((item) => item.id)).toEqual(["approval"]);
    expect(groupSidebarThreads(sessions, projects, latest, "ready")[0]?.id).toBe("review");
    expect(groupSidebarThreads(sessions, projects, latest, "absent")).toEqual([]);
  });

  it("uses latest summaries and updates groups without loading transcripts", () => {
    const sessions = [thread("one")];
    const old = run("one", "running");
    const ended = run("one", "completed", { createdAt: "2026-09-02", hasResult: true });
    expect(groupSidebarThreads(sessions, projects, latestSidebarRuns([old]))[0]?.id).toBe("working");
    expect(groupSidebarThreads(sessions, projects, latestSidebarRuns([ended, old]))[0]?.id).toBe("review");
    expect(groupSidebarThreads(sessions, projects, latestSidebarRuns([{ ...ended, hasResult: false }]))[0]?.id).toBe("other");
  });

  it("sorts pinned first, then recency and stable ID without mutating input", () => {
    const sessions = [thread("z"), thread("b"), thread("new", { updatedAt: "2026-09-02" }), thread("pin", { pinned: true })];
    const original = [...sessions];
    expect(groupSidebarThreads(sessions, projects, new Map())[0]?.threads.map((item) => item.id)).toEqual(["pin", "new", "b", "z"]);
    expect(sessions).toEqual(original);
  });

  it("never hides live work and keeps a selected settled thread visible", () => {
    const threads = Array.from({ length: 30 }, (_, i) => thread(String(i)));
    for (const id of ["attention", "working"] as const) expect(visibleStatusThreads({ id, label: id, threads }, false)).toHaveLength(30);
    const settled = { id: "other" as const, label: "Other", threads };
    expect(visibleStatusThreads(settled, false)).toHaveLength(20);
    expect(visibleStatusThreads(settled, false, "25")).toHaveLength(26);
    expect(visibleStatusThreads(settled, true)).toHaveLength(30);
  });

  it("defaults safely when the local preference is absent, invalid or denied", () => {
    for (const value of [null, "", "unexpected", "project"]) expect(readSidebarGrouping(() => value)).toBe("project");
    expect(readSidebarGrouping(() => "status")).toBe("status");
    expect(readSidebarGrouping(() => "recent")).toBe("recent");
    expect(readSidebarGrouping(() => { throw new Error("Denied"); })).toBe("project");
  });
});

describe("sidebar thread status", () => {
  it("keeps collapsed approvals prominent regardless of thread order", () => {
    expect(resolveProjectThreadKind(["working", "approval", "failed"])).toBe("approval");
    expect(resolveProjectThreadKind(["failed", "approval", "working"])).toBe("approval");
    expect(resolveProjectThreadKind(["approval", "failed"])).toBe("approval");
    expect(resolveProjectThreadKind(["failed", "working"])).toBe("working");
    expect(resolveProjectThreadKind(["ready", "failed"])).toBe("failed");
    expect(resolveProjectThreadKind(["ready"])).toBeUndefined();
    expect(resolveProjectThreadKind([])).toBeUndefined();
  });
  it("treats approval as the attention state", () => {
    expect(resolveSidebarThreadKind({ liveHarness: true, runStatus: "approval_required" })).toBe(
      "approval",
    );
  });

  it("marks a live harness or running turn as working", () => {
    expect(resolveSidebarThreadKind({ liveHarness: true })).toBe("working");
    expect(resolveSidebarThreadKind({ liveHarness: false, runStatus: "running" })).toBe("working");
  });

  it("recedes settled rows only", () => {
    expect(shouldRecedeThread("ready", false)).toBe(true);
    expect(shouldRecedeThread("working", false)).toBe(false);
    expect(shouldRecedeThread("approval", false)).toBe(false);
    expect(shouldRecedeThread("ready", true)).toBe(false);
  });

  it("does not treat an idle persistent harness as working", () => {
    expect(resolveSidebarThreadKind({ liveHarness: false, runStatus: "completed" })).toBe("ready");
  });
});

describe("sidebar time labels", () => {
  it("compacts relative time", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    expect(compactRelativeTime("2026-08-26T11:59:30.000Z", now)).toBe("now");
    expect(compactRelativeTime("2026-08-26T11:10:00.000Z", now)).toBe("50m");
    expect(compactRelativeTime("2026-08-25T12:00:00.000Z", now)).toBe("1d");
  });

  it("formats a working duration", () => {
    expect(formatWorkingDurationLabel(4_000)).toBe("4s");
    expect(formatWorkingDurationLabel(125_000)).toBe("2m");
    expect(formatWorkingDurationLabel(3_700_000)).toBe("1h 1m");
  });
});

describe("splitProjectThreads", () => {
  it("keeps pinned and live rows out of the settled tail", () => {
    const threads = [
      { id: "p", pinned: true, updatedAt: "2026-08-26T10:00:00.000Z" },
      { id: "w", updatedAt: "2026-08-26T11:00:00.000Z" },
      { id: "a", updatedAt: "2026-08-26T11:30:00.000Z" },
      { id: "s", updatedAt: "2026-08-20T11:00:00.000Z" },
    ];
    const split = splitProjectThreads(threads, (thread) => {
      if (thread.id === "w") return "working";
      if (thread.id === "a") return "approval";
      return "ready";
    });
    expect(split.pinned.map((item) => item.id)).toEqual(["p"]);
    expect(split.live.map((item) => item.id)).toEqual(["w", "a"]);
    expect(split.rest.map((item) => item.id)).toEqual(["s"]);
  });
});

describe("threads that answered", () => {
  it("is not a failed thread when the run left an answer", () => {
    expect(
      resolveSidebarThreadKind({ liveHarness: false, runStatus: "failed", runAnswered: true }),
    ).toBe("ready");
  });

  it("is still failed when nothing came back", () => {
    expect(resolveSidebarThreadKind({ liveHarness: false, runStatus: "failed" })).toBe("failed");
  });
});

describe("contract verdicts in the sidebar", () => {
  it("does not call a thread failed over Capsule's own verdict", () => {
    expect(
      resolveSidebarThreadKind({
        liveHarness: false,
        runStatus: "failed",
        runError: "Verification failed",
      }),
    ).toBe("ready");
  });

  it("still reports a fault the runtime reported", () => {
    expect(
      resolveSidebarThreadKind({
        liveHarness: false,
        runStatus: "failed",
        runError: "Claude Code exited before answering.",
      }),
    ).toBe("failed");
  });
});

describe("settled and snoozed shelves", () => {
  const projects = [{ id: "a", name: "Alpha" }];
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const thread = (id: string, extra: Partial<Session> = {}): Session => ({
    id, title: id, projectId: "a", state: "active", updatedAt: "2026-09-01T00:00:00Z", ...extra,
  } as Session);
  const run = (sessionId: string, status: Run["status"]): Run => ({
    id: `run-${sessionId}`, sessionId, status, createdAt: "2026-09-01T00:00:00Z", hasResult: true,
  } as Run);

  it("takes settled threads out of Ready for review and folds the shelves", () => {
    const sessions = [thread("done", { settledAt: "2026-09-02T00:00:00Z" }), thread("later", { snoozedUntil: later }), thread("fresh")];
    const latest = latestSidebarRuns([run("done", "completed"), run("later", "completed"), run("fresh", "completed")]);
    const groups = groupSidebarThreads(sessions, projects, latest);
    expect(groups.map((group) => [group.id, group.threads.map((item) => item.id)])).toEqual([
      ["review", ["fresh"]], ["snoozed", ["later"]], ["settled", ["done"]],
    ]);
    expect(visibleStatusThreads(groups[2]!, false)).toEqual([]);
    expect(visibleStatusThreads(groups[2]!, false, "done").map((item) => item.id)).toEqual(["done"]);
  });

  it("never hides a decision or running work on a shelf", () => {
    const sessions = [thread("asks", { settledAt: "2026-09-02T00:00:00Z" }), thread("busy", { snoozedUntil: later })];
    const latest = latestSidebarRuns([run("asks", "approval_required"), run("busy", "running")]);
    expect(groupSidebarThreads(sessions, projects, latest).map((group) => group.id)).toEqual(["attention", "working"]);
    const kinds: Record<string, "approval" | "working"> = { asks: "approval", busy: "working" };
    const split = splitProjectThreads(sessions, (item) => kinds[item.id]!);
    expect(split.live.map((item) => item.id)).toEqual(["asks", "busy"]);
    expect(split.shelvedSettled).toEqual([]);
  });

  it("splits a project's threads into its shelves, soonest wake first", () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const threads = [thread("a", { snoozedUntil: later }), thread("b", { snoozedUntil: soon }), thread("c", { settledAt: "x" }), thread("d")];
    const split = splitProjectThreads(threads, () => "ready");
    expect(split.shelvedSnoozed.map((item) => item.id)).toEqual(["b", "a"]);
    expect(split.shelvedSettled.map((item) => item.id)).toEqual(["c"]);
    expect(split.rest.map((item) => item.id)).toEqual(["d"]);
  });
});

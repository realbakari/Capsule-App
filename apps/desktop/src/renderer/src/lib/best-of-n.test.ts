import { describe, expect, it } from "vitest";
import type { Session, ThreadGroup } from "@capsule/shared";
import { comparisonStatus, foldComparisons } from "./best-of-n";

const thread = (id: string, groupId?: string): Session => ({
  id, workspaceId: "w", projectId: "p", agentId: id, title: id, mode: "code", state: "active", createdAt: "t", updatedAt: "t", ...(groupId ? { groupId } : {}),
});
const group: ThreadGroup = { id: "g", projectId: "p", kind: "best-of-n", prompt: "Fix", createdAt: "t",
  candidates: [{ sessionId: "b", harnessId: "codex", model: "" }, { sessionId: "a", harnessId: "claude", model: "" }] };

describe("comparisons in the sidebar", () => {
  it("folds a group into one row where its first candidate was, keeping candidate order", () => {
    const folded = foldComparisons([[thread("x"), thread("a", "g")], [thread("y"), thread("b", "g")]], new Map([["g", group]]));
    expect(folded[0]!.map((entry) => entry.kind === "group" ? entry.sessions.map((session) => session.id) : entry.session.id)).toEqual(["x", ["b", "a"]]);
    expect(folded[1]!.map((entry) => entry.kind === "thread" ? entry.session.id : "group")).toEqual(["y"]);
  });

  it("leaves a thread whose group is unknown as a plain row", () => {
    expect(foldComparisons([[thread("a", "missing")]], new Map())[0]).toEqual([{ kind: "thread", session: thread("a", "missing") }]);
  });

  it("says how many agents, what is working, and who was kept", () => {
    const sessions = [thread("a", "g"), thread("b", "g"), thread("c", "g")];
    const name = (session: Session) => session.id.toUpperCase();
    expect(comparisonStatus(group, sessions, new Map([["a", { status: "running" }], ["b", { status: "failed" }]]), name)).toBe("3 agents · 2 working · 1 failed");
    expect(comparisonStatus(group, sessions, new Map([["a", { status: "completed" }], ["b", { status: "completed" }], ["c", { status: "approval_required" }]]), name)).toBe("3 agents · 1 need you");
    expect(comparisonStatus(group, sessions, new Map(sessions.map((session) => [session.id, { status: "completed" as const }])), name)).toBe("3 agents · ready to compare");
    expect(comparisonStatus({ ...group, winnerSessionId: "b" }, sessions, new Map(), name)).toBe("Kept B");
  });
});

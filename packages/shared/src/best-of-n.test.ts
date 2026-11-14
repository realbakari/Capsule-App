import { describe, expect, it } from "vitest";
import { aggregateLeaderboard, candidatePhase, candidateTitle, keepBlocker, readStartBestOfN, type CandidateSummary, type ThreadGroup } from "./best-of-n.js";

describe("the personal leaderboard", () => {
  it("counts comparisons, keeps and thumbs per agent and model, best first", () => {
    const rows = aggregateLeaderboard(
      [
        { harnessId: "codex", model: "", kept: true },
        { harnessId: "claude", model: "opus", kept: false },
        { harnessId: "codex", model: "", kept: false },
        { harnessId: "claude", model: "sonnet", kept: true },
        { harnessId: "claude", model: "opus", kept: false },
      ],
      [
        { harnessId: "claude", model: "sonnet", value: 1 },
        { harnessId: "claude", model: "sonnet", value: 1 },
        { harnessId: "codex", model: "", value: -1 },
        { harnessId: "grok", model: "", value: 1 },
      ],
    );
    expect(rows).toEqual([
      { harnessId: "claude", model: "sonnet", compared: 1, kept: 1, up: 2, down: 0 },
      { harnessId: "codex", model: "", compared: 2, kept: 1, up: 0, down: 1 },
      { harnessId: "grok", model: "", compared: 0, kept: 0, up: 1, down: 0 },
      { harnessId: "claude", model: "opus", compared: 2, kept: 0, up: 0, down: 0 },
    ]);
  });

  it("is empty with nothing compared or rated", () => {
    expect(aggregateLeaderboard([], [])).toEqual([]);
  });
});

describe("a start request from the renderer", () => {
  const valid = { projectId: "p", prompt: "Fix the bug", candidates: [{ harnessId: "codex" }, { harnessId: "claude", model: " opus " }] };

  it("accepts two to four known agents and trims models", () => {
    expect(readStartBestOfN(valid)).toEqual({ projectId: "p", prompt: "Fix the bug", candidates: [{ harnessId: "codex" }, { harnessId: "claude", model: "opus" }] });
    expect(readStartBestOfN({ ...valid, candidates: [{ harnessId: "codex" }, { harnessId: "codex" }] })?.candidates).toHaveLength(2);
  });

  it("refuses one agent, five agents, an unknown agent, or an empty prompt", () => {
    expect(readStartBestOfN({ ...valid, candidates: [{ harnessId: "codex" }] })).toBeUndefined();
    expect(readStartBestOfN({ ...valid, candidates: Array.from({ length: 5 }, () => ({ harnessId: "codex" })) })).toBeUndefined();
    expect(readStartBestOfN({ ...valid, candidates: [{ harnessId: "codex" }, { harnessId: "shell" }] })).toBeUndefined();
    expect(readStartBestOfN({ ...valid, prompt: "  " })).toBeUndefined();
    expect(readStartBestOfN({ ...valid, permissionProfile: "everything" })).toBeUndefined();
  });
});

describe("a candidate's state", () => {
  const group: ThreadGroup = { id: "g", projectId: "p", kind: "best-of-n", prompt: "x", candidates: [], createdAt: "t" };
  const done: CandidateSummary = { sessionId: "a", title: "x", archived: false, worktree: "present", run: { id: "r", status: "completed", createdAt: "t" }, diff: { files: [{ path: "a.ts", added: 1, removed: 0 }], added: 1, removed: 0 } };

  it("reads one phase from the latest turn, and a prompt that never went out as failed", () => {
    expect(candidatePhase({})).toBe("starting");
    expect(candidatePhase({ startError: "Not signed in" })).toBe("failed");
    expect(candidatePhase({ run: { id: "r", status: "approval_required", createdAt: "t" } })).toBe("needs-you");
    expect(candidatePhase({ run: { id: "r", status: "running", createdAt: "t" } })).toBe("running");
  });

  it("says why it cannot be kept", () => {
    expect(keepBlocker(group, done)).toBeUndefined();
    expect(keepBlocker({ ...group, winnerSessionId: "a" }, done)).toBe("Already kept.");
    expect(keepBlocker(group, { ...done, run: { id: "r", status: "running", createdAt: "t" } })).toBe("Wait for this candidate to finish.");
    expect(keepBlocker(group, { ...done, diff: { files: [], added: 0, removed: 0 } })).toBe("This candidate changed no files.");
    expect(keepBlocker(group, { ...done, archived: true, worktree: "set-aside" })).toBe("Restore this thread first.");
  });

  it("titles a candidate after the prompt and its agent", () => {
    expect(candidateTitle("Fix the bug", "Codex")).toBe("Fix the bug · Codex");
    expect(candidateTitle("Fix the bug", "Claude Code", "opus")).toBe("Fix the bug · Claude Code/opus");
  });
});

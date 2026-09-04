import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { loadTurnOutcome, outcomeFiles, outcomesByTurn } from "./turn-outcomes";
import { turnsFromMessages } from "./turns";

const time = (second: number) => `2026-09-04T00:00:${String(second).padStart(2, "0")}.000Z`;
const run = (id: string, second: number, patch: Partial<Run> = {}): Run => ({
  id, sessionId: "s", projectId: "p", agentId: "general", prompt: "hello", status: "completed",
  checkpointRef: `refs/capsule/checkpoints/s/turn/${second}`, createdAt: time(second), updatedAt: time(second), ...patch,
});
const message = (id: string, role: ChatMessage["role"], second: number, runId?: string): ChatMessage => ({
  id, sessionId: "s", role, content: "hello", createdAt: time(second), runId,
});
const event = (runId: string, text = "Edited src/app.ts"): RunEvent => ({
  id: `${runId}-event`, runId, timestamp: time(1), type: "tool", message: text,
});

describe("turn ownership", () => {
  it("keeps newest-first runs attached to their prompts, not the conversation footer", () => {
    const turns = turnsFromMessages([message("u1", "user", 1, "r1"), message("a1", "assistant", 2, "r1"), message("u2", "user", 3, "r2"), message("a2", "assistant", 4, "r2")]);
    const mapped = outcomesByTurn(turns, [run("r2", 3), run("r1", 1)], "s", "p");
    expect(mapped.get("u1")?.map((item) => item.id)).toEqual(["r1"]);
    expect(mapped.get("u2")?.map((item) => item.id)).toEqual(["r2"]);
  });

  it("matches repeated legacy prompts by time rather than reusing an old checkpoint", () => {
    const turns = turnsFromMessages([message("u1", "user", 1), message("a1", "assistant", 3), message("u2", "user", 4)]);
    const mapped = outcomesByTurn(turns, [run("r2", 5), run("r1", 2)], "s", "p");
    expect(mapped.get("u1")?.[0]?.id).toBe("r1");
    expect(mapped.get("u2")?.[0]?.id).toBe("r2");
  });

  it("does not move a late answer's old run under the follow-up prompt", () => {
    const turns = turnsFromMessages([message("u1", "user", 1), message("u2", "user", 4, "r2"), message("a1", "assistant", 5, "r1")]);
    const mapped = outcomesByTurn(turns, [run("r1", 2), run("r2", 4)], "s", "p");
    expect(mapped.get("u1")?.[0]?.id).toBe("r1");
    expect(mapped.get("u2")?.map((item) => item.id)).toEqual(["r2"]);
  });

  it("supports a loaded history page beginning with a reply", () => {
    const mapped = outcomesByTurn(turnsFromMessages([message("a1", "assistant", 3, "r1")]), [run("r1", 1)], "s", "p");
    expect(mapped.get("a1")?.[0]?.id).toBe("r1");
  });

  it("rejects stale project/session data, in-flight runs and unowned checkpoints", () => {
    const turns = turnsFromMessages([message("u1", "user", 1, "r1")]);
    for (const patch of [{ projectId: "other" }, { sessionId: "other" }, { status: "running" as const }, { status: "waiting" as const }, { status: "approval_required" as const }]) {
      expect(outcomesByTurn(turns, [run("r1", 1, patch)], "s", "p").size).toBe(0);
    }
    expect(outcomesByTurn(turns, [run("orphan", 0)], "s", "p").size).toBe(0);
    expect(outcomesByTurn(turns, [run("r1", 1)], undefined, "p").size).toBe(0);
  });
});

describe("turn file evidence", () => {
  it("keeps a successful empty snapshot empty, even when there were writes", () => {
    expect(outcomeFiles({ patch: "", files: [], available: true }, [event("r")], "r")).toEqual([]);
  });

  it("uses only this run's write events when there is no saved baseline", () => {
    expect(outcomeFiles({ patch: "", files: [], available: false }, [event("r"), event("old", "Created old.ts"), event("r", "Read dirty.ts")], "r")).toEqual([{ path: "src/app.ts", action: "modified" }]);
  });

  it("does not call a file deleted just because its change removed lines", () => {
    const diff = { available: true, patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1 @@\n keep\n-remove\n", files: [{ path: "a.ts", added: 0, removed: 1 }] };
    expect(outcomeFiles(diff, [], "r")[0]?.action).toBe("modified");
  });

  it("loads the named run only, and avoids event fallback for an empty diff", async () => {
    const reader = { turnDiff: vi.fn().mockResolvedValue({ patch: "", files: [], available: true }), listRunEvents: vi.fn().mockResolvedValue([event("old")]) };
    expect((await loadTurnOutcome(run("r", 1), "/repo", reader)).files).toEqual([]);
    expect(reader.turnDiff).toHaveBeenCalledWith("r");
    expect(reader.listRunEvents).not.toHaveBeenCalled();
    reader.turnDiff.mockResolvedValue({ patch: "", files: [], available: false });
    await loadTurnOutcome(run("r", 1), "/repo", reader);
    expect(reader.listRunEvents).toHaveBeenCalledWith("r");
  });
});

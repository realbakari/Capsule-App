import { describe, expect, it } from "vitest";
import { readPlanEntries, taskProgress, tasksFromRunEvents } from "./run-tasks.js";
import type { RunEvent } from "./types.js";

const event = (type: string, data?: Record<string, unknown>, message = ""): RunEvent => ({
  id: type, runId: "run", timestamp: "2026-09-14T00:00:00Z", type, message, data,
});

describe("plan entries", () => {
  it("clears a previous plan on an empty replacement, but not malformed data", () => {
    const populated = event("plan", { entries: [{ content: "First", status: "in_progress" }] });
    expect(tasksFromRunEvents([populated, event("plan", { entries: [] })])).toEqual([]);
    expect(tasksFromRunEvents([populated, event("plan", { update: { entries: [] } })])).toEqual([]);
    expect(tasksFromRunEvents([populated, event("plan", { entries: null })])).toHaveLength(1);
  });
  it("reads ACP entries and todo lists, and ignores empty or hostile rows", () => {
    expect(readPlanEntries({
      entries: [
        { content: "Map the Review panel", status: "completed" },
        { content: "Add stack reads", status: "in_progress" },
        { text: "Show the tree", status: "pending" },
      ],
    })?.map((task) => [task.content, task.status])).toEqual([
      ["Map the Review panel", "completed"],
      ["Add stack reads", "inProgress"],
      ["Show the tree", "pending"],
    ]);
    expect(readPlanEntries({ todos: [{ content: "Only", status: "DONE" }] })?.[0]?.status).toBe("completed");
    expect(readPlanEntries({ entries: [{ content: "" }, null] })).toBeUndefined();
    expect(readPlanEntries({ entries: [{ content: "A ".repeat(200), status: "pending" }] })?.[0]?.content).toMatch(/truncated/);
  });

  it("keeps the latest plan snapshot from a run and ignores unrelated tools", () => {
    const tasks = tasksFromRunEvents([
      event("plan", { streamKind: "plan", entries: [{ content: "First", status: "pending" }] }),
      event("tool", { title: "Read file", rawInput: { path: "secret.ts" } }, "Read file"),
      event("tool", { streamKind: "tool", title: "todo_write", todos: [{ content: "Later", status: "in_progress" }] }, "todo_write"),
    ]);
    expect(tasks).toEqual([{ id: "0", content: "Later", status: "inProgress" }]);
    expect(taskProgress(tasks)).toEqual({ step: "Later", completedSteps: 0, totalSteps: 1 });
  });
});

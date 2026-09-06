import { describe, expect, it } from "vitest";
import { delegatedTasks, readDelegationDetails } from "./delegation.js";
import type { Run, RunEvent } from "./types.js";

const run = { id: "run", sessionId: "thread", status: "running" } as Run;
const event = (data: Record<string, unknown>, extra = {}): RunEvent => ({ id: "event", runId: run.id, type: "tool", timestamp: "2026-01-01", message: "", data, ...extra });
const start = { toolCallId: "task", title: "Agent", status: "in_progress", rawInput: { subagent_type: "reviewer", description: "Review changes" } };
describe("delegation telemetry", () => {
  it("requires structured identity, never guesses from prose or a tool title", () => {
    expect(delegatedTasks(run, [event({ title: "Spawn Agent", toolCallId: "shell", status: "completed" }), event({ toolCallId: "x", rawOutput: { usage: { total_tokens: 30 } } })])).toEqual([]);
  });
  it("folds partial updates in stable order and preserves explicitly reported zero", () => {
    const tasks = delegatedTasks(run, [event(start), event({ ...start, toolCallId: "second" }), event({ toolCallId: "task", status: "completed", rawOutput: { usage: { total_tokens: 0 } } })]);
    expect(tasks.map((task) => task.id)).toEqual(["task", "second"]);
    expect(tasks[0]).toMatchObject({ title: "Review changes", role: "reviewer", status: "completed", totalTokens: 0 });
    expect(tasks[1]?.totalTokens).toBeUndefined();
  });
  it("scopes both routes to the owning run and thread", () => {
    const details = readDelegationDetails(start);
    const direct = { toolCallId: "task", status: "in_progress", delegation: details };
    expect(delegatedTasks(run, [event(direct, { runId: "other" }), event(start, { sessionId: "other" })])).toEqual([]);
    expect(delegatedTasks(run, [event(direct)])[0]).toMatchObject({ status: "running", title: "Review changes" });
    expect(delegatedTasks(run, [event({ data: start })])[0]).toMatchObject({ status: "running" });
    expect(delegatedTasks(run, [event({ delegationTool: direct, status: "error" })])[0]).toMatchObject({ status: "running" });
  });
  it("does not turn parent completion into child completion or infer token totals", () => {
    expect(delegatedTasks({ ...run, status: "completed" }, [event(start)])[0]?.status).toBe("running");
    expect(readDelegationDetails({ rawInput: { subagent_type: "worker" }, rawOutput: { usage: { total_tokens: -1 } } })?.totalTokens).toBeUndefined();
    expect(readDelegationDetails({ rawInput: { subagent_type: "worker" }, rawOutput: { usage: { total_tokens: "100" } } })?.totalTokens).toBeUndefined();
  });
  it("bounds labels and task count, including malformed stored metadata", () => {
    expect(readDelegationDetails({ rawInput: { subagent_type: "x".repeat(10000) } })?.role?.length).toBeLessThanOrEqual(180);
    expect(delegatedTasks(run, Array.from({ length: 150 }, (_, i) => event({ ...start, toolCallId: String(i) })))).toHaveLength(100);
    expect(delegatedTasks(run, [event({ toolCallId: "bad", delegation: { role: {}, totalTokens: Infinity } })])).toEqual([]);
  });
});

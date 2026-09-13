import { describe, expect, it } from "vitest";
import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { turnTranscript, toolGroupLabel, toolObservationState } from "./turn-timeline.js";

const run = { id: "run", status: "running" } as Run;
const time = (second: number) => new Date(1_000_000 + second * 1000).toISOString();
const message = (id: string, second: number): ChatMessage => ({ id, sessionId: "s", role: second ? "assistant" : "user", content: id, createdAt: time(second) });
const event = (id: string, second: number, status = "in_progress"): RunEvent => ({
  id: `${id}:${second}`, runId: run.id, type: "tool", message: "Execute git status", timestamp: time(second),
  data: { toolCallId: id, status, kind: "execute" },
});

describe("turn transcript", () => {
  it("intersperses work and replies, retaining the invocation position after completion", () => {
    const messages = [message("prompt", 0), message("checking", 1), message("summary", 4)];
    const result = turnTranscript(messages, [event("a", 2), event("b", 3), event("a", 5, "completed")], run);
    expect(result.rows.map((row) => row.id)).toEqual(["prompt", "checking", "activity:a", "summary"]);
    const activity = result.rows[2];
    expect(activity?.kind).toBe("activity");
    if (activity?.kind !== "activity") throw new Error("Expected activity");
    expect(toolGroupLabel(activity.tools)).toBe("2 commands");
    expect(activity.tools.map((tool) => tool.status)).toEqual(["completed", "running"]);
  });
  it("filters other runs and reasoning, and reads legacy nested tool metadata", () => {
    const result = turnTranscript([], [
      { ...event("foreign", 1), runId: "other" },
      { ...event("thought", 1), type: "thinking" },
      { ...event("legacy", 2), message: "", data: { streamKind: "tool", data: { toolCallId: "legacy", text: "Read files", status: "failed" } } },
    ], run);
    expect(result.rows).toMatchObject([{ kind: "activity", tools: [{ id: "legacy", title: "Read files", status: "failed" }] }]);
  });
  it("never infers successful tool completion from a successful turn", () => {
    const result = turnTranscript([], [event("a", 1)], run);
    const row = result.rows[0];
    if (row?.kind !== "activity") throw new Error("Expected activity");
    const tool = row.tools[0]!;
    expect(toolObservationState(tool, { ...run, status: "completed" })).toBe("Completion not reported");
    expect(toolObservationState(tool, { ...run, status: "cancelled" })).toBe("Stopped");
    expect(toolObservationState(tool, run, true)).toBe("Stopping");
  });
  it("bounds inline work and does not double-count anonymous completions", () => {
    const result = turnTranscript([], [...Array.from({ length: 140 }, (_, i) => event(String(i), i)),
      { ...event("end", 200), type: "tool.completed", data: undefined }], run);
    expect(result.partial).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.kind === "activity" && result.rows[0].tools.length).toBe(100);
  });
});

import { describe, expect, it } from "vitest";
import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { turnTranscript, toolKindFrom, toolKindOrder, toolObservationState } from "./turn-timeline.js";

const run = { id: "run", status: "running" } as Run;
const time = (second: number) => new Date(1_000_000 + second * 1000).toISOString();
const message = (id: string, second: number): ChatMessage => ({ id, sessionId: "s", role: second ? "assistant" : "user", content: id, createdAt: time(second) });
const event = (id: string, second: number, status = "in_progress"): RunEvent => ({
  id: `${id}:${second}`, runId: run.id, type: "tool", message: "Execute git status", timestamp: time(second),
  data: { toolCallId: id, status, kind: "execute" },
});

describe("turn transcript", () => {
  it("merges direct and nested gateway details without duplicating a tool or losing input", () => {
    const started = { ...event("a", 1), data: { toolCallId: "a", details: { input: "git status", locations: ["README.md"] } } };
    const completed = { ...event("a", 2), data: { data: { toolCallId: "a", status: "completed", rawOutput: "clean" } } };
    const rows = turnTranscript([], [started, completed], run).rows;
    expect(rows).toMatchObject([{ kind: "activity", tools: [{ id: "a", status: "completed", details: { input: "git status", output: "clean", locations: ["README.md"] } }] }]);
    expect(turnTranscript([], [started, completed, { ...event("a", 3), data: { toolCallId: "a", content: [], locations: [] } }], run).rows)
      .toMatchObject([{ tools: [{ details: { input: "git status", output: "", locations: [] } }] }]);
  });
  it("intersperses work and replies, retaining the invocation position after completion", () => {
    const messages = [message("prompt", 0), message("checking", 1), message("summary", 4)];
    const result = turnTranscript(messages, [event("a", 2), event("b", 3), event("a", 5, "completed")], run);
    expect(result.rows.map((row) => row.id)).toEqual(["prompt", "checking", "activity:a", "summary"]);
    const activity = result.rows[2];
    expect(activity?.kind).toBe("activity");
    if (activity?.kind !== "activity") throw new Error("Expected activity");
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
  it("classifies tool kinds from the ACP kind and the title", () => {
    expect(toolKindFrom("read", "anything", false)).toBe("read");
    expect(toolKindFrom("execute", "git status", true)).toBe("execute");
    expect(toolKindFrom("move", "Organize module", false)).toBe("move");
    expect(toolKindFrom("switch_mode", "Use planning mode", false)).toBe("switch_mode");
    expect(toolKindFrom(undefined, "todo_write", false)).toBe("todo");
    expect(toolKindFrom(undefined, "Read README.md", false)).toBe("read");
    expect(toolKindFrom(undefined, "grep src", false)).toBe("search");
    expect(toolKindOrder([
      { id: "a", timestamp: time(1), title: "Read", command: false, kind: "read", status: "completed" },
      { id: "b", timestamp: time(2), title: "Edit", command: false, kind: "edit", status: "completed" },
      { id: "c", timestamp: time(3), title: "Read again", command: false, kind: "read", status: "completed" },
    ])).toEqual(["read", "edit"]);
  });

  it.each([false, true])("preserves move and mode changes through route metadata (nested: %s)", (nested) => {
    const events = ["move", "switch_mode"].map((kind, index) => {
      const data = { toolCallId: kind, kind, title: "Agent operation", status: "in_progress" };
      return { ...event(kind, index), data: nested ? { data } : data };
    });
    expect(turnTranscript([], events, run).rows).toMatchObject([
      { kind: "activity", tools: [{ kind: "move" }, { kind: "switch_mode" }] },
    ]);
  });

  it("bounds inline work and does not double-count anonymous completions", () => {
    const result = turnTranscript([], [...Array.from({ length: 140 }, (_, i) => event(String(i), i)),
      { ...event("end", 200), type: "tool.completed", data: undefined }], run);
    expect(result.partial).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.kind === "activity" && result.rows[0].tools.length).toBe(100);
  });
});

describe("work log notes", () => {
  const settled = { ...run, status: "completed" } as Run;
  const note = (id: string, second: number, type: string, data: Record<string, unknown> = {}, text = ""): RunEvent => ({
    id: `${id}:${second}`, runId: run.id, type, message: text, timestamp: time(second), data,
  });

  it("keeps a settled turn's reasoning as one row per stretch, between the work it explains", () => {
    const events = [note("t", 1, "thinking", { streamKind: "thinking" }, "Read the "), note("t", 2, "thinking", { streamKind: "thinking" }, "parser first."), event("a", 3), note("t", 4, "thinking", { streamKind: "thinking", segment: true }, "Now edit it.")];
    expect(turnTranscript([], events, settled).rows).toMatchObject([
      { kind: "note", note: { kind: "reasoning", text: "Read the parser first." } },
      { kind: "activity", tools: [{ id: "a" }] },
      { kind: "note", note: { kind: "reasoning", text: "Now edit it.\n\n" } },
    ]);
  });

  it("leaves reasoning to the live card while the turn runs, and out entirely when hidden", () => {
    const events = [note("t", 1, "thinking", { streamKind: "thinking" }, "Hmm"), event("a", 2)];
    expect(turnTranscript([], events, run).rows.map((row) => row.kind)).toEqual(["activity"]);
    expect(turnTranscript([], events, settled, { reasoning: "hidden" }).rows.map((row) => row.kind)).toEqual(["activity"]);
  });

  it("records a person's decisions, but not a runtime's own approval frame", () => {
    const events = [
      note("r", 1, "approval.resolved", { status: "running" }, "Approval granted"),
      note("d", 2, "approval.resolved", { decision: "approved_once", action: "Run command", target: "git push" }),
      note("n", 3, "approval.resolved", { decision: "denied", action: "Edit file", target: "src/a.ts" }),
      note("q", 4, "approval.resolved", { decision: "denied", action: "Question", question: true }),
      note("a", 5, "question.answered", { questions: [{ question: "Which branch?", answer: "main" }] }),
    ];
    expect(turnTranscript([], events, run).rows.map((row) => row.kind === "note" && row.note.kind === "decision" ? [row.note.outcome, row.note.subject, row.note.detail] : row.kind)).toEqual([
      ["allowed", "Run command", "git push"],
      ["denied", "Edit file", "src/a.ts"],
      ["unanswered", "Question", undefined],
      ["answered", "main", "Which branch?: main"],
    ]);
  });

  it("shows a compaction once, running until it reports its end", () => {
    const start = note("c", 1, "compaction", { streamKind: "compaction", phase: "start" });
    const end = note("c", 2, "compaction", { streamKind: "compaction", phase: "end" });
    expect(turnTranscript([], [start], run).rows).toMatchObject([{ kind: "note", note: { kind: "compaction", active: true, automatic: true } }]);
    expect(turnTranscript([], [start, end], run).rows).toMatchObject([{ kind: "note", note: { kind: "compaction", active: false } }]);
  });

  it("replaces a tool's output whole, so an old tail never follows a new head", () => {
    const first = { ...event("a", 1), data: { toolCallId: "a", details: { output: "head", outputTail: "old end", omittedLines: 9 } } };
    const second = { ...event("a", 2, "completed"), data: { toolCallId: "a", status: "completed", rawOutput: "short" } };
    expect(turnTranscript([], [first, second], run).rows).toMatchObject([{ tools: [{ details: { output: "short", outputTail: undefined, omittedLines: undefined } }] }]);
  });
});

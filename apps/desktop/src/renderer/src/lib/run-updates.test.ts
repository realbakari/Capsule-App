import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { batchRunFrames, mergeMessagePage, mergeRunEvents, mergeRuns } from "./run-updates";

const run = { id: "r", sessionId: "s", projectId: "p", agentId: "a", prompt: "work", status: "running", createdAt: "01", updatedAt: "01" } as Run;
const event = (id: string, runId = "r"): RunEvent => ({ id, runId, type: "assistant", timestamp: "01", message: id });
afterEach(() => { vi.useRealTimers(); });

describe("incremental run updates", () => {
  it("batches bursts without dropping events and flushes completion immediately", () => {
    vi.useFakeTimers();
    const consume = vi.fn();
    const batch = batchRunFrames(consume);
    for (let index = 0; index < 100; index++) batch.push(event(String(index)));
    expect(consume).not.toHaveBeenCalled();
    batch.push({ ...run, status: "completed", completedAt: "02" });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]![0]).toHaveLength(101);
    vi.advanceTimersByTime(100);
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it("bounds burst queues and disposes pending UI work", () => {
    vi.useFakeTimers();
    const consume = vi.fn(); const batch = batchRunFrames(consume);
    for (let index = 0; index < 1_000; index++) batch.push(event(String(index)));
    vi.advanceTimersByTime(50);
    expect(consume.mock.calls.flatMap(([frames]) => frames)).toHaveLength(1_000);
    expect(consume).toHaveBeenCalledTimes(8);
    batch.push(event("pending")); batch.dispose(); vi.advanceTimersByTime(50);
    expect(consume).toHaveBeenCalledTimes(8);
  });
  it("merges overlapping history and live frames only for the owned run", () => {
    expect(mergeRunEvents([event("a"), event("b")], [event("b"), event("c"), event("x", "other")], "r").map((item) => item.id)).toEqual(["a", "b", "c"]);
    const completed = { ...run, status: "completed", updatedAt: "02", checkpointRef: "ref" } as Run;
    expect(mergeRuns([run], [completed, { ...run, id: "new", createdAt: "03" }])).toEqual([{ ...run, id: "new", createdAt: "03" }, completed]);
    expect(mergeRuns([completed], [run])).toEqual([completed]);
  });
  it("keeps older messages and racing replies while replacing optimistic duplicates", () => {
    const message = (id: string, content = id) => ({ id, content, sessionId: "s", role: "user", createdAt: id } as ChatMessage);
    expect(mergeMessagePage([message("old"), message("local-1", "hello"), message("racing")], [message("saved", "hello")]).map((item) => item.id)).toEqual(["old", "racing", "saved"]);
  });
});

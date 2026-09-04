import { describe, expect, it } from "vitest";
import { isReplyAlreadyRecorded } from "./replies.js";
import type { ChatMessage } from "./types.js";

const message = (over: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage => ({
  id: over.id ?? `msg_${Math.random()}`,
  sessionId: "s1",
  content: over.content ?? "",
  createdAt: over.createdAt ?? "2026-09-04T16:14:37.655Z",
  ...over,
});

describe("isReplyAlreadyRecorded", () => {
  it("recognises the same reply already attributed to the turn", () => {
    const messages = [message({ role: "assistant", content: "Done.", runId: "run_1" })];
    expect(isReplyAlreadyRecorded(messages, "Done.", "run_1")).toBe(true);
  });

  it("does not treat another turn's identical reply as this turn's", () => {
    const messages = [message({ role: "assistant", content: "Done.", runId: "run_1" })];
    expect(isReplyAlreadyRecorded(messages, "Done.", "run_2")).toBe(false);
  });

  it("catches the copy that arrives after the run has settled", () => {
    /*
     * The observed bug, exactly: the reply is stored with its run, then the
     * identical text arrives ~60ms later with no run to attribute it to. The
     * old check asked whether it was the newest message; this asks whether
     * the same answer is already in the turn.
     */
    const messages = [
      message({ role: "user", content: "push it", createdAt: "2026-09-04T16:14:27.653Z" }),
      message({
        role: "assistant",
        content: "Confirmed.",
        runId: "run_ba46",
        createdAt: "2026-09-04T16:14:37.655Z",
      }),
    ];
    expect(isReplyAlreadyRecorded(messages, "Confirmed.", undefined)).toBe(true);
  });

  it("still catches it when something lands in between", () => {
    // The case the positional check got wrong: no longer the newest message.
    const messages = [
      message({ role: "user", content: "go", createdAt: "2026-09-04T16:14:27.000Z" }),
      message({ role: "assistant", content: "Confirmed.", runId: "r", createdAt: "2026-09-04T16:14:37.000Z" }),
      message({ role: "system", content: "note", createdAt: "2026-09-04T16:14:38.000Z" }),
    ];
    expect(isReplyAlreadyRecorded(messages, "Confirmed.", undefined)).toBe(true);
  });

  it("lets the same answer appear again in a later turn", () => {
    /*
     * Asking the same question twice must produce the answer twice. Scoping
     * to the turn is what keeps deduplication from eating a real reply.
     */
    const messages = [
      message({ role: "user", content: "status?", createdAt: "2026-09-04T16:00:00.000Z" }),
      message({ role: "assistant", content: "All clear.", runId: "run_1", createdAt: "2026-09-04T16:00:05.000Z" }),
      message({ role: "user", content: "status?", createdAt: "2026-09-04T16:30:00.000Z" }),
    ];
    expect(isReplyAlreadyRecorded(messages, "All clear.", undefined)).toBe(false);
    expect(isReplyAlreadyRecorded(messages, "All clear.", "run_2")).toBe(false);
  });

  it("does not confuse a different reply for a duplicate", () => {
    const messages = [
      message({ role: "user", content: "go", createdAt: "2026-09-04T16:00:00.000Z" }),
      message({ role: "assistant", content: "First.", runId: "r", createdAt: "2026-09-04T16:00:01.000Z" }),
    ];
    expect(isReplyAlreadyRecorded(messages, "Second.", undefined)).toBe(false);
  });

  it("does not let an unreadable timestamp license a second copy", () => {
    const messages = [
      message({ role: "user", content: "go", createdAt: "2026-09-04T16:00:00.000Z" }),
      message({ role: "assistant", content: "Done.", runId: "r", createdAt: "not a date" }),
    ];
    expect(isReplyAlreadyRecorded(messages, "Done.", undefined)).toBe(true);
  });

  it("handles a thread with no user message yet", () => {
    const messages = [message({ role: "assistant", content: "Hello.", createdAt: "2026-09-04T16:00:00.000Z" })];
    expect(isReplyAlreadyRecorded(messages, "Hello.", undefined)).toBe(true);
    expect(isReplyAlreadyRecorded([], "Hello.", undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { threadError, threadErrorKey } from "./thread-error";

const run = (
  sessionId: string,
  status: string,
  createdAt: string,
  error?: string,
): { sessionId: string; status: string; error?: string; createdAt: string } => ({
  sessionId,
  status,
  createdAt,
  ...(error ? { error } : {}),
});

describe("threadError", () => {
  it("reports why the newest turn failed", () => {
    expect(
      threadError({
        sessionId: "s1",
        runs: [run("s1", "failed", "2026-09-02T10:00:00Z", "You've hit your session limit.")],
      }),
    ).toBe("You've hit your session limit.");
  });

  it("cleans the message the same way everything else does", () => {
    expect(
      threadError({
        sessionId: "s1",
        runs: [
          run(
            "s1",
            "failed",
            "2026-09-02T10:00:00Z",
            "ACP error (ACP_TURN_FAILED): Out of credit next: Retry the turn.",
          ),
        ],
      }),
    ).toBe("Out of credit");
  });

  it("goes quiet once a later turn succeeds", () => {
    // An older failure the conversation moved past is history, not state.
    expect(
      threadError({
        sessionId: "s1",
        runs: [
          run("s1", "failed", "2026-09-02T10:00:00Z", "Broke"),
          run("s1", "completed", "2026-09-02T10:05:00Z"),
        ],
      }),
    ).toBeUndefined();
  });

  it("says nothing about a turn that answered", () => {
    // 90 tools, a full reply on screen, and a contract check that came back
    // unhappy afterwards: red over the top of that is a lie about the turn.
    expect(
      threadError({
        sessionId: "s1",
        runs: [
          {
            sessionId: "s1",
            status: "failed",
            createdAt: "2026-09-02T10:00:00Z",
            error: "Verification failed",
            result: "Here is the summary you asked for.",
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("keeps Capsule's own contract verdicts out of the thread", () => {
    // "Verification failed" is this app judging the turn against a contract
    // it wrote for itself. It is not something the reader can act on.
    for (const verdict of ["Verification failed", "Empty result", "Completed"]) {
      expect(
        threadError({
          sessionId: "s1",
          runs: [run("s1", "failed", "2026-09-02T10:00:00Z", verdict)],
        }),
      ).toBeUndefined();
    }
  });

  it("stays in its own thread", () => {
    expect(
      threadError({ sessionId: "s2", runs: [run("s1", "failed", "2026-09-02T10:00:00Z", "Broke")] }),
    ).toBeUndefined();
  });

  it("has nothing to say without a reason or a thread", () => {
    expect(threadError({ sessionId: "s1", runs: [run("s1", "failed", "2026-09-02T10:00:00Z")] })).toBeUndefined();
    expect(threadError({ runs: [] })).toBeUndefined();
  });
});

describe("threadErrorKey", () => {
  it("remembers the error and the thread together", () => {
    // The thread alone would silence the next, different failure; the message
    // alone would silence the same failure somewhere else.
    expect(threadErrorKey("s1", "Broke")).not.toBe(threadErrorKey("s2", "Broke"));
    expect(threadErrorKey("s1", "Broke")).not.toBe(threadErrorKey("s1", "Broke again"));
    expect(threadErrorKey("s1", "Broke")).toBe(threadErrorKey("s1", "Broke"));
  });

  it("has no key without both", () => {
    expect(threadErrorKey(undefined, "Broke")).toBeUndefined();
    expect(threadErrorKey("s1", undefined)).toBeUndefined();
  });
});

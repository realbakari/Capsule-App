import { describe, expect, it } from "vitest";
import { IDLE_BEATS, REST_AFTER, petCommand, shouldCelebrate } from "./behavior";

describe("companion behaviour", () => {
  it.each(["dance", "Capsule, dance!", "Hey Capsule do a dance"])("recognizes the bounded phrase %s", text => {
    expect(petCommand(text)).toEqual({ kind: "gesture", reaction: "dance" });
  });
  it("opens tasks without interpreting the text as a coding instruction", () => {
    expect(petCommand("show my tasks")).toEqual({ kind: "tasks" });
    for (const text of ["dance and delete my project", "run a command", "send hello", "approve everything", "do whatever you want"]) expect(petCommand(text)).toBeUndefined();
  });
  it("does not celebrate existing, failed or repeated completion states", () => {
    expect(shouldCelebrate("running", "ready")).toBe(true);
    for (const previous of [undefined, "ready", "blocked", "needs-input"] as const) expect(shouldCelebrate(previous, "ready")).toBe(false);
    expect(shouldCelebrate("running", "blocked")).toBe(false);
  });
  it("leaves quiet intervals and stops idle gestures before resting", () => {
    expect(IDLE_BEATS[0]?.after).toBeGreaterThanOrEqual(30_000);
    expect(IDLE_BEATS.every(beat => beat.after < REST_AFTER)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { AttentionSummary } from "@capsule/shared";
import { IDLE_BEATS, REACTION_DURATION, REST_AFTER, captionFor, gaze, isReactionTrack, moodFor, nextGlance, petCommand, shouldCelebrate } from "./behavior";

const summary = (items: AttentionSummary["items"]): AttentionSummary => ({
  items, state: items[0]?.state,
  counts: { "needs-input": 0, blocked: 0, ready: 0, running: 0, ...Object.fromEntries(items.map(item => [item.state, items.filter(other => other.state === item.state).length])) },
});
const item = (sessionId: string, state: AttentionSummary["items"][number]["state"], title = sessionId) => ({ sessionId, title, state, at: "2026-01-01T00:00:00.000Z" });

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

  it("gives every state its own face, and lets what it is doing override it", () => {
    const faces = (["idle", "running", "ready", "needs-input", "blocked"] as const).map(state => moodFor(state, {}));
    expect(new Set(faces).size).toBe(5);
    expect(moodFor("blocked", { greeting: true })).toBe("beaming");
    expect(moodFor("idle", { resting: true, greeting: true })).toBe("sleepy");
    expect(moodFor("idle", { yawning: true, resting: true })).toBe("yawning");
  });

  it("names the thread that wants you, and only offers to open threads that are not just working", () => {
    expect(captionFor(undefined, true)).toEqual({ text: "Status unavailable" });
    expect(captionFor(undefined, false).text).toBe("Checking activity…");
    expect(captionFor(summary([]), false)).toEqual({ text: "Nothing waiting" });
    expect(captionFor(summary([item("a", "needs-input", "Approve the plan"), item("b", "blocked"), item("c", "running")]), false))
      .toEqual({ text: "Needs you", detail: "Approve the plan", more: 1, sessionId: "a" });
    expect(captionFor(summary([item("a", "running", "Build")]), false)).toEqual({ text: "Working", detail: "Build" });
    expect(captionFor(summary([item("a", "running"), item("b", "running")]), false)).toEqual({ text: "2 working" });
  });

  it("wanders on an uneven schedule, never in a rhythm", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const waits = Array.from({ length: 12 }, () => nextGlance(random));
    for (const glance of waits) {
      expect(glance.wait).toBeGreaterThanOrEqual(2600);
      expect(glance.wait).toBeLessThan(8000);
      expect(Math.abs(glance.look.x)).toBeLessThanOrEqual(3.5);
    }
    expect(new Set(waits.map(glance => Math.round(glance.wait / 250))).size).toBeGreaterThan(6);
  });

  it("follows the pointer but never looks out of its eyes", () => {
    expect(gaze(0, 0)).toEqual({ x: 0, y: 0, lean: 0 });
    const far = gaze(5000, -5000);
    expect(far.x).toBeLessThanOrEqual(3.5);
    expect(far.y).toBeGreaterThanOrEqual(-2.5);
    expect(Math.abs(far.lean)).toBeLessThanOrEqual(3);
    expect(gaze(-40, 0).x).toBeLessThan(0);
  });

  it("replays only gesture tracks", () => {
    expect(isReactionTrack("petPlayHop")).toBe(true);
    for (const name of ["petBreathe", "petBlink", "petFloat"]) expect(isReactionTrack(name)).toBe(false);
    expect(Object.values(REACTION_DURATION).every(ms => ms >= 1000 && ms <= 4000)).toBe(true);
  });
});

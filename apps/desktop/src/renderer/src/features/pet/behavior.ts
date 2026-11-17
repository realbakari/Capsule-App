import type { AttentionState, AttentionSummary } from "@capsule/shared";

export type CompanionState = AttentionState | "idle";

export type PetReaction = "greet" | "roll" | "bounce" | "dance" | "stretch" | "yawn";
/**
 * Every gesture's length. Its keyframes are named `petPlay…`, so replaying a
 * gesture can rewind exactly its own tracks and leave breathing and blinking
 * on their phase.
 */
export const REACTION_DURATION: Record<PetReaction, number> = { greet: 1700, roll: 1500, bounce: 1500, dance: 3600, stretch: 2800, yawn: 2600 };
export const isReactionTrack = (name: string) => name.startsWith("petPlay");
export const IDLE_BEATS = [{ after: 45_000, reaction: "stretch" }, { after: 90_000, reaction: "yawn" }] satisfies Array<{ after: number; reaction: PetReaction }>;
export const REST_AFTER = 120_000;

/** A face is chosen by state, then overridden by what the companion is doing. */
export type Mood = "calm" | "focused" | "happy" | "curious" | "worried" | "beaming" | "sleepy" | "yawning";
const STATE_MOOD: Record<CompanionState, Mood> = { idle: "calm", running: "focused", ready: "happy", "needs-input": "curious", blocked: "worried" };
export function moodFor(state: CompanionState, now: { greeting?: boolean; resting?: boolean; yawning?: boolean }): Mood {
  if (now.yawning) return "yawning";
  if (now.resting) return "sleepy";
  if (now.greeting) return "beaming";
  return STATE_MOOD[state];
}

/**
 * Where the eyes go when nobody is pointing. The waits are long and uneven so
 * the glances never fall into a rhythm; `random` is injectable for tests.
 */
const GLANCES = [{ x: -3, y: -1 }, { x: 3, y: -0.5 }, { x: -1.5, y: 1.5 }, { x: 2, y: 1.2 }, { x: 0, y: -1.5 }, { x: -2.5, y: 0.5 }];
export function nextGlance(random: () => number = Math.random): { wait: number; hold: number; look: { x: number; y: number } } {
  return { wait: 2600 + random() * 5400, hold: 450 + random() * 900, look: GLANCES[Math.floor(random() * GLANCES.length) % GLANCES.length]! };
}

/** Pointer offset in px → eye offset in viewBox units, saturating softly at the edge of the eye. */
export function gaze(dx: number, dy: number): { x: number; y: number; lean: number } {
  return { x: 3.5 * Math.tanh(dx / 90), y: 2.5 * Math.tanh(dy / 90), lean: 3 * Math.tanh(dx / 160) };
}

const STATE_WORD: Record<AttentionState, string> = { "needs-input": "Needs you", blocked: "Stopped", ready: "Ready", running: "Working" };
export const stateWord = (state: AttentionState) => STATE_WORD[state];

/**
 * The caption names the thread that wants you, so one click can open it.
 * Counts stay for the rest; a running thread is never a call to action.
 */
export function captionFor(summary: AttentionSummary | undefined, error: boolean): { text: string; detail?: string; more?: number; sessionId?: string } {
  if (error) return { text: "Status unavailable" };
  if (!summary) return { text: "Checking activity…" };
  const first = summary.items[0];
  if (!first) return { text: "Nothing waiting" };
  const same = summary.items.filter((item) => item.state === first.state).length;
  const more = summary.items.filter((item) => item.state !== "running").length - 1;
  if (first.state === "running") return { text: same > 1 ? `${same} working` : "Working", detail: same > 1 ? undefined : first.title };
  return { text: STATE_WORD[first.state], detail: first.title, more: more > 0 ? more : undefined, sessionId: first.sessionId };
}

export type PetCommand = { kind: "gesture"; reaction: PetReaction } | { kind: "tasks" | "status" | "pause" | "resume" | "sleep" | "wake" };
/** Only these phrases perform actions. Recognized text never becomes a prompt. */
export function petCommand(text: string): PetCommand | undefined {
  const command = text.toLowerCase().replace(/[.!?,]/g, "").trim().replace(/^(?:hey )?capsule\s+/, "").replace(/\s+/g, " ");
  switch (command) {
    case "dance": case "do a dance": return { kind: "gesture", reaction: "dance" };
    case "hello": case "hi": case "wave": return { kind: "gesture", reaction: "greet" };
    case "roll": return { kind: "gesture", reaction: "roll" };
    case "bounce": case "jump": return { kind: "gesture", reaction: "bounce" };
    case "stretch": return { kind: "gesture", reaction: "stretch" };
    case "show tasks": case "show my tasks": case "open tasks": return { kind: "tasks" };
    case "status": case "read status": return { kind: "status" };
    case "pause": case "pause motion": return { kind: "pause" };
    case "resume": case "resume motion": return { kind: "resume" };
    case "sleep": case "rest": return { kind: "sleep" };
    case "wake": case "wake up": return { kind: "wake" };
    default: return undefined;
  }
}

export function shouldCelebrate(previous: AttentionSummary["state"], next: AttentionSummary["state"]): boolean {
  return previous === "running" && next === "ready";
}

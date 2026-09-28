import type { AttentionSummary } from "@capsule/shared";

export type PetReaction = "greet" | "roll" | "bounce" | "dance" | "stretch" | "yawn";
export const REACTION_DURATION: Record<PetReaction, number> = { greet: 1600, roll: 1800, bounce: 2200, dance: 4200, stretch: 3200, yawn: 2800 };
export const REACTION_TRACKS = new Set(["capsuleGreet", "capsuleWave", "capsuleHeadGreet", "capsuleRoll", "capsuleBounce", "capsuleJumpLeft", "capsuleJumpRight", "capsuleGreetShadow", "capsuleRollShadow", "capsuleBounceShadow", "capsuleDance", "capsuleDanceLeft", "capsuleDanceRight", "capsuleDanceShadow", "capsuleStretch", "capsuleStretchLeft", "capsuleStretchRight", "capsuleYawn"]);
export const IDLE_BEATS = [{ after: 45_000, reaction: "stretch" }, { after: 90_000, reaction: "yawn" }] satisfies Array<{ after: number; reaction: PetReaction }>;
export const REST_AFTER = 120_000;

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

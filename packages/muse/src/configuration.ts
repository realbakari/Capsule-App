import type { AcpConfigOption } from "@capsule/shared";
import { object } from "./protocol.js";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const REASONING_HISTORY_LIMIT = 100;

export function readReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? value as ReasoningEffort : undefined;
}

export function reasoningOption(currentValue?: ReasoningEffort): AcpConfigOption {
  const names = ["None", "Minimal", "Low", "Medium", "High", "Extra high", "Maximum", "Ultra"];
  return {
    id: "reasoning_effort", category: "thought_level", name: "Reasoning effort",
    description: "Session default for future turns. This does not change reasoning visibility.",
    currentValue,
    choices: REASONING_EFFORTS.map((value, index) => ({ value, name: names[index]! })),
  };
}

/** Pages are ascending even when requested backward. Never retain transcript events. */
export function reasoningFromPage(value: unknown, sessionId: string): ReasoningEffort | undefined {
  const events = object(value).events;
  if (!Array.isArray(events) || events.length > REASONING_HISTORY_LIMIT) return undefined;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = object(events[index]);
    const params = object(event.params);
    if (event.method !== "session/reasoningEffortChanged" || params.sessionId !== sessionId) continue;
    const effort = readReasoningEffort(params.reasoningEffort);
    if (effort) return effort;
  }
  return undefined;
}

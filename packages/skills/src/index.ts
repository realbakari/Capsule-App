import type { AgentMode, Skill } from "@capsule/shared";
import { PACKED_SKILLS } from "./packs.js";

export * from "./packs.js";
export * from "./client.js";
export * from "./github.js";

export const DEFAULT_SKILLS: Skill[] = PACKED_SKILLS;

const MODE_SKILL: Record<AgentMode, string | undefined> = {
  chat: undefined,
  agent: undefined,
  plan: "coding",
  code: "coding",
  research: "research",
  browser: "browser",
  automation: undefined,
};

export function skillIdForMode(mode: AgentMode): string | undefined {
  return MODE_SKILL[mode];
}

import type { AgentMode, Skill } from "@capsule/shared";

export const DEFAULT_SKILLS: Skill[] = [
  {
    id: "coding",
    name: "Coding",
    version: "1.0.0",
    description: "Implement, refactor, and review source code.",
    source: "capsule",
    status: "installed",
    requirements: [],
    permissions: { filesystem: "approval", terminal: "approval" },
    validation: "passed",
  },
  {
    id: "research",
    name: "Research",
    version: "1.0.0",
    description: "Gather sources and produce cited analysis.",
    source: "capsule",
    status: "installed",
    requirements: ["network"],
    permissions: { network: "allow" },
    validation: "passed",
  },
  {
    id: "browser",
    name: "Browser",
    version: "1.0.0",
    description: "Inspect and interact with web pages.",
    source: "openclaw",
    status: "installed",
    requirements: [],
    permissions: { network: "allow" },
    validation: "passed",
  },
  {
    id: "git",
    name: "Git",
    version: "1.0.0",
    description: "Inspect branches, diffs, and commits. Never auto-commit.",
    source: "capsule",
    status: "installed",
    requirements: ["git"],
    permissions: { git: "allow" },
    validation: "passed",
  },
  {
    id: "testing",
    name: "Testing",
    version: "1.0.0",
    description: "Run and interpret project tests.",
    source: "capsule",
    status: "installed",
    requirements: [],
    permissions: { terminal: "approval" },
    validation: "passed",
  },
];

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

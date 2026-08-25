import type { Agent, AgentMode } from "@capsule/shared";

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: "general",
    name: "General",
    description: "Conversation-first assistant for everyday tasks.",
    runtime: "mock",
    model: "default",
    skills: [],
    tools: ["web", "files"],
    permissions: { filesystem: "allow", terminal: "approval", network: "allow" },
    status: "idle",
    kind: "agent",
    recentRunIds: [],
  },
  {
    id: "coding",
    name: "Coding",
    description: "Implements software changes with files, tests, and Git.",
    runtime: "mock",
    model: "default",
    skills: ["coding", "git", "testing"],
    tools: ["files", "terminal", "git"],
    permissions: { filesystem: "approval", terminal: "approval", network: "allow" },
    status: "idle",
    kind: "agent",
    recentRunIds: [],
  },
  {
    id: "research",
    name: "Research",
    description: "Searches the web, gathers sources, and synthesizes findings.",
    runtime: "mock",
    model: "default",
    skills: ["research"],
    tools: ["web_search"],
    permissions: { filesystem: "allow", terminal: "block", network: "allow" },
    status: "idle",
    kind: "agent",
    recentRunIds: [],
  },
  {
    id: "browser",
    name: "Browser",
    description: "Drives browser automation for inspection and extraction.",
    runtime: "mock",
    model: "default",
    skills: ["browser"],
    tools: ["browser"],
    permissions: { filesystem: "allow", terminal: "block", network: "allow" },
    status: "idle",
    kind: "agent",
    recentRunIds: [],
  },
];

const MODE_AGENT: Record<AgentMode, string> = {
  chat: "general",
  agent: "general",
  plan: "coding",
  code: "coding",
  research: "research",
  browser: "browser",
  automation: "general",
};

export function agentIdForMode(mode: AgentMode): string {
  return MODE_AGENT[mode];
}

export function excludeSystemAgents(agents: Agent[]): Agent[] {
  return agents.filter((agent) => agent.kind !== "system");
}

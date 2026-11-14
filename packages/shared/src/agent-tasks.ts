import { BOARD_DEPENDENCY_LIMIT, type BoardCardState } from "./board.js";
import type { WorkspaceMode } from "./types.js";

/**
 * Tasks an agent creates from inside a thread: board cards in that thread's
 * project, recorded as created by it. The person decides whether an agent may
 * start work; by default every agent-created card is a draft.
 */

/** What `create_task` asks for, after validation. */
export interface AgentTaskRequest {
  title: string;
  prompt: string;
  agentId?: string;
  workspaceMode?: WorkspaceMode;
  dependsOn: string[];
}

/** A card as `list_tasks` reports it to the agent. */
export interface AgentTaskSummary {
  id: string;
  title: string;
  state: BoardCardState["column"] | "idle";
  createdByYou: boolean;
  dependsOn: string[];
}

export const AGENT_TASK_TITLE_LIMIT = 200;
export const AGENT_TASK_PROMPT_LIMIT = 20_000;

/**
 * The start rule. Without the project's permission an agent-created card is
 * a draft that never starts on its own, even when chained, so an agent can
 * never fan out work the person did not see. With it, a card with nothing
 * to wait for starts now and a chained one starts when its cards are done.
 */
export function agentTaskStart(allowed: boolean, dependsOn: readonly string[]): { start: boolean; autoStart: boolean } {
  if (!allowed) return { start: false, autoStart: false };
  return dependsOn.length ? { start: false, autoStart: true } : { start: true, autoStart: true };
}

/** Why an agent may not start a card by hand, or undefined when it may. */
export function agentTaskStartRefusal(allowed: boolean): string | undefined {
  return allowed ? undefined
    : "This project keeps agent-created tasks as drafts. The person starts them from the board, or turns on starting agent tasks for the project.";
}

export function projectAllowsAgentStarts(allowedProjects: readonly string[] | undefined, projectId: string): boolean {
  return Boolean(allowedProjects?.includes(projectId));
}

const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;

/** Validate `create_task` arguments from an agent. Returns the reason on failure. */
export function readAgentTaskRequest(args: Record<string, unknown>): AgentTaskRequest | { error: string } {
  const title = text(args.title, AGENT_TASK_TITLE_LIMIT);
  if (!title) return { error: `Give the task a title of at most ${AGENT_TASK_TITLE_LIMIT} characters.` };
  const prompt = text(args.prompt, AGENT_TASK_PROMPT_LIMIT);
  if (!prompt) return { error: `Give the task a prompt of at most ${AGENT_TASK_PROMPT_LIMIT} characters.` };
  if (args.agent !== undefined && !text(args.agent, 64)) return { error: "agent must be an agent id such as \"claude\"." };
  if (args.workspace !== undefined && args.workspace !== "local" && args.workspace !== "worktree") return { error: "workspace must be \"local\" or \"worktree\"." };
  const raw = args.depends_on ?? [];
  if (!Array.isArray(raw) || raw.length > BOARD_DEPENDENCY_LIMIT || raw.some((id) => !text(id, 256))) {
    return { error: `depends_on must be a list of at most ${BOARD_DEPENDENCY_LIMIT} task ids from list_tasks.` };
  }
  return {
    title,
    prompt,
    dependsOn: [...new Set((raw as string[]).map((id) => id.trim()))],
    ...(args.agent !== undefined ? { agentId: (args.agent as string).trim() } : {}),
    ...(args.workspace !== undefined ? { workspaceMode: args.workspace as WorkspaceMode } : {}),
  };
}

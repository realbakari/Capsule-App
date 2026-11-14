import { AGENT_TASK_PROMPT_LIMIT, AGENT_TASK_TITLE_LIMIT, BOARD_DEPENDENCY_LIMIT } from "@capsule/shared";
import { startLocalMcpServer, toolSchema, type LocalMcpServer, type LocalToolResult } from "./local-mcp";

/**
 * `capsule-tasks`: lets an agent put follow-up work on the board of the
 * project its thread belongs to. A token resolves only its thread, and the
 * engine scopes every call to that thread's project.
 */

export interface TaskTarget {
  threadId: string;
}

export const TASK_TOOLS = [
  {
    name: "create_task",
    description: "Put a new task on this project's board as its own thread. It is a draft the person reviews and starts, unless they let agents start tasks in this project. Returns the task id.",
    inputSchema: toolSchema({
      title: { type: "string", maxLength: AGENT_TASK_TITLE_LIMIT, description: "Short title for the board card." },
      prompt: { type: "string", maxLength: AGENT_TASK_PROMPT_LIMIT, description: "The full prompt the new thread starts with. It does not see this conversation, so include what it needs." },
      agent: { type: "string", maxLength: 64, description: "Agent id to run it, such as \"claude\" or \"codex\". Defaults to the project's agent." },
      workspace: { type: "string", enum: ["local", "worktree"], description: "Share the project checkout, or work in its own git worktree." },
      depends_on: { type: "array", items: { type: "string" }, maxItems: BOARD_DEPENDENCY_LIMIT, description: "Ids of tasks that must be marked done before this one starts." },
    }, ["title", "prompt"]),
  },
  {
    name: "start_task",
    description: "Start a draft task you created, now. Refused when the person keeps agent tasks as drafts in this project.",
    inputSchema: toolSchema({ id: { type: "string", maxLength: 256 } }, ["id"]),
  },
  {
    name: "list_tasks",
    description: "List tasks on this project's board: drafts and tasks created by agents, with their state and whether you created them.",
    inputSchema: toolSchema(),
  },
] as const;

export function startTasksMcpServer(
  call: (threadId: string, name: string, args: Record<string, unknown>) => Promise<LocalToolResult>,
  admit?: (operation: () => Promise<Record<string, unknown> | undefined>) => Promise<Record<string, unknown> | undefined>,
): Promise<LocalMcpServer<TaskTarget>> {
  return startLocalMcpServer<TaskTarget>({
    name: "capsule-tasks",
    version: "1",
    tools: TASK_TOOLS,
    call: (target, name, args) => call(target.threadId, name, args),
    ...(admit ? { admit } : {}),
  });
}

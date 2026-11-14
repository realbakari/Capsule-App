import {
  agentTaskStart,
  agentTaskStartRefusal,
  boardCardState,
  readAgentTaskRequest,
  type AgentTaskSummary,
  type BoardContext,
  type BoardRun,
  type CreateBoardCardInput,
  type Session,
  type ThreadOrigin,
} from "@capsule/shared";

/**
 * The task tools an agent calls from inside a thread. Every call is scoped to
 * the calling thread's project: it cannot see, link or start a card in any
 * other project, and it can start only cards it created itself.
 */

export interface AgentTaskHost {
  getSession(id: string): Session | undefined;
  listSessions(): Session[];
  latestRuns(): ReadonlyMap<string, BoardRun>;
  /** Whether the person lets agents in this project start the tasks they create. */
  allowsStarts(projectId: string): boolean;
  createCard(input: CreateBoardCardInput, origin: ThreadOrigin): Promise<Session>;
  startCard(id: string): Promise<Session>;
}

export type AgentTaskResult = { ok: true; detail: string; data?: unknown } | { ok: false; detail: string };

const LIST_LIMIT = 50;

export class AgentTasks {
  constructor(private readonly host: AgentTaskHost) {}

  async create(callerId: string, args: Record<string, unknown>): Promise<AgentTaskResult> {
    const caller = this.caller(callerId);
    if (!caller) return gone;
    const request = readAgentTaskRequest(args);
    if ("error" in request) return { ok: false, detail: request.error };
    const foreign = request.dependsOn.find((id) => this.host.getSession(id)?.projectId !== caller.projectId);
    if (foreign) return { ok: false, detail: `No task ${foreign} in this project. Use an id from list_tasks.` };
    const allowed = this.host.allowsStarts(caller.projectId);
    const { start, autoStart } = agentTaskStart(allowed, request.dependsOn);
    const card = await this.host.createCard({
      projectId: caller.projectId,
      title: request.title,
      prompt: request.prompt,
      dependsOn: request.dependsOn,
      autoStart,
      ...(start ? { start } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.workspaceMode ? { workspaceMode: request.workspaceMode } : {}),
    }, { kind: "task", sessionId: caller.id });
    const detail = start ? "Created and started the task."
      : autoStart ? "Created the task. It starts once the tasks it depends on are marked done."
        : "Created the task as a draft on the board. The person reviews and starts it.";
    return { ok: true, detail, data: { id: card.id, title: card.title, started: start } };
  }

  async start(callerId: string, id: unknown): Promise<AgentTaskResult> {
    const caller = this.caller(callerId);
    if (!caller) return gone;
    if (typeof id !== "string" || !id) return { ok: false, detail: "Pass the id of a task from list_tasks." };
    const card = this.host.getSession(id);
    if (!card || card.projectId !== caller.projectId) return { ok: false, detail: `No task ${id} in this project.` };
    if (card.origin?.kind !== "task" || card.origin.sessionId !== caller.id) return { ok: false, detail: "You can start only tasks you created." };
    if (!card.pendingStart) return { ok: false, detail: "That task has already started." };
    const refusal = agentTaskStartRefusal(this.host.allowsStarts(caller.projectId));
    if (refusal) return { ok: false, detail: refusal };
    await this.host.startCard(id);
    return { ok: true, detail: "Started the task.", data: { id } };
  }

  list(callerId: string): AgentTaskResult {
    const caller = this.caller(callerId);
    if (!caller) return gone;
    const sessions = this.host.listSessions();
    const context: BoardContext = { sessions: new Map(sessions.map((session) => [session.id, session])), latestRuns: this.host.latestRuns() };
    const tasks: AgentTaskSummary[] = sessions
      .filter((session) => session.projectId === caller.projectId && session.id !== caller.id && (session.pendingStart || session.origin?.kind === "task"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, LIST_LIMIT)
      .map((session) => ({
        id: session.id,
        title: session.title,
        state: boardCardState(session, context)?.column ?? "idle",
        createdByYou: session.origin?.kind === "task" && session.origin.sessionId === caller.id,
        dependsOn: session.pendingStart?.dependsOn ?? [],
      }));
    const starts = this.host.allowsStarts(caller.projectId) ? "You may start tasks you created." : "Tasks you create stay drafts until the person starts them.";
    return { ok: true, detail: `${tasks.length} task${tasks.length === 1 ? "" : "s"} on this project's board. ${starts}`, data: tasks };
  }

  private caller(id: string): Session | undefined {
    return this.host.getSession(id);
  }
}

const gone: AgentTaskResult = { ok: false, detail: "This thread no longer exists, so it cannot manage tasks." };

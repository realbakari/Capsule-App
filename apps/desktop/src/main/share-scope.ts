import {
  DEFAULT_CAPSULE_SETTINGS,
  IPC_EVENTS,
  SETTINGS_SECTION_KEYS,
  type ApprovalRequest,
  type Agent,
  type CapsuleSettings,
  type Project,
  type Run,
  type RuntimeStatus,
  type Session,
} from "@capsule/shared";

/*
 * What a share link may read: one thread, and the least of everything else the
 * viewer needs to draw it.
 *
 * This is the only allowlist for share links. A channel not named here is
 * refused; a named one is held to the grant's thread by id before the real
 * handler runs; and the app-wide reads a page needs to start (projects,
 * threads, settings) are answered with that one thread's slice, stripped of
 * local paths, so nothing about the rest of the machine reaches the link.
 */

export interface ShareGrantScope {
  id: string;
  sessionId: string;
}

export interface ShareScopeDeps {
  session: (id: string) => Session | undefined;
  project: (id: string) => Project | undefined;
  run: (id: string) => Run | undefined;
  sessionOfMessage: (id: string) => string | undefined;
  /** The handler the desktop window would reach for this channel. */
  call: (channel: string, args: unknown[]) => Promise<unknown>;
}

export const SHARE_REFUSAL = "This link can only read the conversation it was shared for.";

type Rule = (grant: ShareGrantScope, args: unknown[], deps: ShareScopeDeps, session: Session) => Promise<unknown> | unknown;

function refuse(): never {
  throw new Error(SHARE_REFUSAL);
}

function ownSession(grant: ShareGrantScope, value: unknown): void {
  if (value !== grant.sessionId) refuse();
}

function ownRun(grant: ShareGrantScope, value: unknown, deps: ShareScopeDeps): string {
  if (typeof value !== "string" || deps.run(value)?.sessionId !== grant.sessionId) refuse();
  return value;
}

/** The thread with nothing that locates it on disk or names a live agent process. */
export function sharedSession(session: Session): Session {
  const { id, workspaceId, projectId, agentId, title, mode, state, harnessId, modelOverride, workspaceMode, worktreeBranch, turnMode, forkedFrom, createdAt, updatedAt } = session;
  return { id, workspaceId, projectId, agentId, title, mode, state, createdAt, updatedAt,
    ...(harnessId ? { harnessId } : {}), ...(modelOverride ? { modelOverride } : {}), ...(workspaceMode ? { workspaceMode } : {}),
    ...(worktreeBranch ? { worktreeBranch } : {}), ...(turnMode ? { turnMode } : {}), ...(forkedFrom ? { forkedFrom } : {}) };
}

export function sharedProject(project: Project): Project {
  const { id, workspaceId, name, defaultMode, createdAt, updatedAt } = project;
  return { id, workspaceId, name, defaultMode, defaultSkillIds: [], createdAt, updatedAt };
}

export function sharedRun<T extends Run>(run: T): T {
  const { workingDirectory: _folder, revision: _revision, ...rest } = run;
  if (!rest.verification?.evidence) return rest as T;
  const { evidence: _evidence, ...verification } = rest.verification;
  return { ...rest, verification } as T;
}

function sharedSettings(real: CapsuleSettings): CapsuleSettings {
  const appearance: Partial<Record<keyof CapsuleSettings, unknown>> = {};
  for (const key of SETTINGS_SECTION_KEYS.appearance ?? []) appearance[key] = real[key];
  return { ...DEFAULT_CAPSULE_SETTINGS, ...appearance, runtimeMode: "direct", remoteAccess: "off" } as CapsuleSettings;
}

const forward = (channel: string): Rule => (_grant, args, deps) => deps.call(channel, args);
const empty: Rule = () => [];

const RULES: Record<string, Rule> = {
  rendererReady: () => true,
  windowBackground: () => true,
  listProjects: (_grant, _args, deps, session) => {
    const project = deps.project(session.projectId);
    return project ? [sharedProject(project)] : [];
  },
  getProject: (_grant, args, deps, session) => {
    if (args[0] !== session.projectId) refuse();
    const project = deps.project(session.projectId);
    return project ? sharedProject(project) : undefined;
  },
  listSessions: (_grant, _args, _deps, session) => [sharedSession(session)],
  listMessages: (grant, args, deps) => { ownSession(grant, args[0]); return deps.call("listMessages", [grant.sessionId]); },
  listMessagePage: (grant, args, deps) => { ownSession(grant, args[0]); return deps.call("listMessagePage", [grant.sessionId, args[1]]); },
  threadMarkdown: (grant, args, deps) => { ownSession(grant, args[0]); return deps.call("threadMarkdown", [grant.sessionId, args[1]]); },
  getFollowUps: (grant, args, deps) => { ownSession(grant, args[0]); return deps.call("getFollowUps", [grant.sessionId]); },
  messageImage: (grant, args, deps) => {
    if (typeof args[0] !== "string" || deps.sessionOfMessage(args[0]) !== grant.sessionId) refuse();
    return deps.call("messageImage", args);
  },
  listRuns: async (grant, args, deps) => {
    ownSession(grant, args[0]);
    return ((await deps.call("listRuns", [grant.sessionId])) as Run[]).map(sharedRun);
  },
  listRunPage: async (grant, args, deps) => {
    const query = (args[0] && typeof args[0] === "object" ? args[0] : {}) as { sessionId?: unknown; before?: unknown; limit?: unknown };
    ownSession(grant, query.sessionId);
    const page = await deps.call("listRunPage", [{ sessionId: grant.sessionId, before: query.before, limit: query.limit }]) as { runs: Run[] };
    return { ...page, runs: page.runs.map(sharedRun) };
  },
  listLatestRuns: async (grant, _args, deps) =>
    ((await deps.call("listLatestRuns", [])) as Run[]).filter((run) => run.sessionId === grant.sessionId).map(sharedRun),
  getRun: async (grant, args, deps) => {
    const run = await deps.call("getRun", [ownRun(grant, args[0], deps)]) as Run | undefined;
    return run ? sharedRun(run) : run;
  },
  listRunEvents: (grant, args, deps) => deps.call("listRunEvents", [ownRun(grant, args[0], deps)]),
  listRunEventPage: (grant, args, deps) => deps.call("listRunEventPage", [ownRun(grant, args[0], deps), args[1]]),
  listArtifacts: (grant, args, deps) => deps.call("listArtifacts", [ownRun(grant, args[0], deps)]),
  turnDiff: (grant, args, deps) => deps.call("turnDiff", [ownRun(grant, args[0], deps), args[1]]),
  listApprovals: async (grant, args, deps) =>
    ((await deps.call("listApprovals", [args[0]])) as ApprovalRequest[]).filter((approval) => deps.run(approval.runId)?.sessionId === grant.sessionId),
  listAgents: async (_grant, _args, deps, session) =>
    ((await deps.call("listAgents", [])) as Agent[]).filter((agent) => agent.id === session.agentId || agent.id === session.harnessId),
  getSubsystemStatus: forward("getSubsystemStatus"),
  getStatus: async (_grant, _args, deps): Promise<RuntimeStatus> => {
    const status = await deps.call("getStatus", []) as RuntimeStatus;
    return { state: "connected", kind: status.kind, gatewayUrl: "", gatewayHost: "", gatewayPort: 0, agentCount: 0, sessionCount: 1, activeRunCount: 0 };
  },
  getSettings: async (_grant, _args, deps) => sharedSettings(await deps.call("getSettings", []) as CapsuleSettings),
  // The page asks for these as it starts; a shared thread has none of them.
  listSkills: empty,
  listSkillPacks: empty,
  listHarnesses: empty,
  listHarnessSessions: empty,
  forkBranches: empty,
  listProjectActionRuns: empty,
  redoPoint: () => null,
  // The folder's branch and changes are the machine's, not the thread's.
  gitStatus: () => undefined,
  // Nor are its app updates.
  updateStatus: () => undefined,
};

/** Answers a share link's call within its grant, or refuses it. */
export async function shareScopedCall(grant: ShareGrantScope, channel: string, args: unknown[], deps: ShareScopeDeps): Promise<unknown> {
  if (!Object.hasOwn(RULES, channel)) refuse();
  const session = deps.session(grant.sessionId);
  if (!session) refuse();
  return await RULES[channel]!(grant, args, deps, session);
}

/** The event as a link may see it, or undefined when it does not concern the shared thread. */
export function shareEvent(grant: ShareGrantScope, event: string, payload: unknown, deps: Pick<ShareScopeDeps, "run">): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as { sessionId?: unknown; runId?: unknown };
  const ownRunId = typeof record.runId === "string" && deps.run(record.runId)?.sessionId === grant.sessionId;
  if (event === IPC_EVENTS.message) return record.sessionId === grant.sessionId ? payload : undefined;
  if (event === IPC_EVENTS.approval) return ownRunId ? payload : undefined;
  if (event !== IPC_EVENTS.run) return undefined;
  if (record.sessionId !== undefined ? record.sessionId !== grant.sessionId : !ownRunId) return undefined;
  // A run frame carries the same folder fields a read strips.
  return "status" in payload && "prompt" in payload ? sharedRun(payload as Run) : payload;
}

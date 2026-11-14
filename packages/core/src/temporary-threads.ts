import { CapsuleDatabase, CapsuleRepositories } from "@capsule/database";
import type { Session } from "@capsule/shared";

/*
 * Temporary threads: conversations that never reach the database file.
 *
 * A temporary thread's rows live in a second, in-memory SQLite database with
 * the same schema, so every code path that reads or writes a thread works
 * unchanged. The engine is handed one repositories object; each call that
 * concerns a thread, a turn or a message is routed by whether that thread is
 * temporary, and calls that list across threads read both. Everything else
 * (settings, projects, agents, skills) only ever goes to the file.
 *
 * The in-memory database goes with the process, so a temporary thread is gone
 * on quit. Keep moves its rows into the file and drops the in-memory copy.
 */

type Repo = CapsuleRepositories;
type Method = { [K in keyof Repo]: Repo[K] extends (...args: never[]) => unknown ? K : never }[keyof Repo];

/** Which store answers: one of them, both merged, or the first that has it. */
type Target = "memory" | "persistent" | "merge" | "first" | "both";

interface Ids {
  sessions: Set<string>;
  runs: Set<string>;
  messages: Set<string>;
}

type Router = (ids: Ids, args: unknown[]) => Target;

const bySession = (pick: (args: unknown[]) => string | undefined, otherwise: Target = "persistent"): Router =>
  (ids, args) => {
    const id = pick(args);
    return id === undefined ? otherwise : ids.sessions.has(id) ? "memory" : "persistent";
  };
const byRun = (pick: (args: unknown[]) => string | undefined, otherwise: Target = "persistent"): Router =>
  (ids, args) => {
    const id = pick(args);
    return id === undefined ? otherwise : ids.runs.has(id) ? "memory" : "persistent";
  };
const first = (args: unknown[]) => args[0] as string | undefined;
const field = (name: string) => (args: unknown[]) => (args[0] as Record<string, string | undefined> | undefined)?.[name];
const merge: Router = () => "merge";

/* Per-thread settings (queued follow-ups) are keyed `<prefix>:<thread id>`. */
const bySettingKey: Router = (ids, args) => (ids.sessions.has(String(args[0]).split(":").pop() ?? "") ? "memory" : "persistent");

const ROUTES: Partial<Record<Method, Router>> = {
  getSetting: bySettingKey,
  setSetting: bySettingKey,
  deleteSetting: bySettingKey,
  listSettingKeys: merge,
  insertSession: (ids, args) => ((args[0] as Session).temporary || ids.sessions.has((args[0] as Session).id) ? "memory" : "persistent"),
  updateSession: bySession(field("id")),
  updateSessionBoard: bySession(field("id")),
  setSessionGroup: bySession(first),
  setSessionPullRequest: bySession(first),
  setSessionPaused: bySession(first),
  setSessionTags: bySession(first),
  deleteSession: bySession(first),
  getSession: bySession(first),
  deleteProject: () => "both",
  listSessions: merge,
  splitTranscript: bySession(first),
  parkTranscript: (ids, args) => ((args[0] as string[]).some((id) => ids.messages.has(id)) || (args[1] as string[]).some((id) => ids.runs.has(id)) ? "memory" : "persistent"),
  unparkTranscript: (ids, args) => {
    const rows = args[0] as { messages?: Array<Record<string, unknown>>; runs?: Array<Record<string, unknown>> };
    const owner = rows.messages?.[0]?.session_id ?? rows.runs?.[0]?.session_id;
    return typeof owner === "string" && ids.sessions.has(owner) ? "memory" : "persistent";
  },
  copyTranscript: bySession(field("toSessionId")),
  insertRestorePoint: bySession(field("sessionId")),
  listRestorePoints: bySession(first),
  deleteRestorePoint: () => "both",
  hasMessagesSince: bySession(first),
  insertMessage: bySession(field("sessionId")),
  getMessageAttachments: (ids, args) => (ids.messages.has(args[0] as string) ? "memory" : "persistent"),
  firstUserTitleSeed: bySession(first),
  listMessages: bySession(first),
  listMessagesBefore: bySession(first),
  searchMessages: merge,
  insertRun: bySession(field("sessionId")),
  updateRun: bySession(field("sessionId")),
  getRun: byRun(first),
  getRunProgress: byRun(first),
  findReplyRun: bySession(first),
  listRunPage: bySession(field("sessionId")),
  hasRecordedReply: bySession(first),
  readReplyText: bySession(first),
  previousCheckpoint: byRun(first),
  listRuns: bySession(first, "merge"),
  listLatestRuns: merge,
  listLatestRunStates: merge,
  insertRunEvent: byRun(field("runId")),
  listRunEvents: byRun(first),
  listRunEventPage: byRun(first),
  insertContract: byRun(field("runId")),
  getContract: () => "first",
  insertPolicyDecision: byRun(field("runId")),
  insertApproval: byRun(field("runId")),
  updateApproval: byRun(field("runId")),
  listApprovals: merge,
  insertArtifact: bySession(field("sessionId")),
  listArtifacts: byRun(first, "merge"),
  setRunRating: bySession(field("sessionId")),
  clearRunRating: byRun(first),
  listRunRatings: bySession(first, "merge"),
};

/** Mark rows read from memory, which has no column for it. */
const markTemporary = (value: unknown): unknown => Array.isArray(value)
  ? value.map(markTemporary)
  : value ? { ...(value as Session), temporary: true } : value;

function sortSessions(sessions: Session[]): Session[] {
  return sessions.sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || (left.pinOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinOrder ?? Number.MAX_SAFE_INTEGER)
    || right.updatedAt.localeCompare(left.updatedAt));
}

export class TemporaryThreads {
  private readonly ids: Ids = { sessions: new Set(), runs: new Set(), messages: new Set() };
  private readonly database = new CapsuleDatabase(":memory:");
  private readonly memory = new CapsuleRepositories(this.database);
  /** What the engine uses: the file's repositories, with temporary threads routed to memory. */
  readonly repos: Repo;

  constructor(private readonly persistent: Repo) {
    const wrappers = new Map<PropertyKey, unknown>();
    this.repos = new Proxy(persistent, {
      get: (target, property) => {
        const route = ROUTES[property as Method];
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (!wrappers.has(property)) {
          wrappers.set(property, route
            ? (...args: unknown[]) => this.call(property as Method, route(this.ids, args), args)
            : value.bind(target));
        }
        return wrappers.get(property);
      },
    });
  }

  has(sessionId: string): boolean {
    return this.ids.sessions.has(sessionId);
  }

  /** Every temporary thread's id. */
  list(): string[] {
    return [...this.ids.sessions];
  }

  /**
   * Move a temporary thread into the file: the thread, its messages, turns,
   * events and ratings. Restore points stay behind; they only serve Redo,
   * which lasts until the next message anyway.
   */
  keep(sessionId: string): void {
    const session = this.memory.getSession(sessionId);
    if (!session) throw new Error("That conversation is not temporary.");
    const split = this.memory.splitTranscript(sessionId);
    const messageIds = [...split.before.messageIds, ...split.after.messageIds];
    const runIds = [...split.before.runIds, ...split.after.runIds];
    const ratings = this.memory.listRunRatings(sessionId);
    const rows = this.memory.parkTranscript(messageIds, runIds);
    this.persistent.insertSession(session);
    if (session.tags?.length) this.persistent.setSessionTags(sessionId, session.tags);
    this.persistent.unparkTranscript(rows);
    for (const rating of ratings) this.persistent.setRunRating(rating);
    for (const key of this.memory.listSettingKeys("")) {
      if (key.split(":").pop() !== sessionId) continue;
      const value = this.memory.getSetting(key);
      if (value !== undefined) this.persistent.setSetting(key, value);
      this.memory.deleteSetting(key);
    }
    this.memory.deleteSession(sessionId);
    this.ids.sessions.delete(sessionId);
    for (const id of messageIds) this.ids.messages.delete(id);
    for (const id of runIds) this.ids.runs.delete(id);
  }

  close(): void {
    this.database.sqlite.close();
  }

  private call(method: Method, target: Target, args: unknown[]): unknown {
    const invoke = (repos: Repo) => (repos[method] as (...values: unknown[]) => unknown).apply(repos, args);
    if (target === "persistent") return invoke(this.persistent);
    if (target === "memory") return this.memoryCall(method, args, invoke);
    if (target === "both") {
      invoke(this.memory);
      return invoke(this.persistent);
    }
    if (target === "first") return invoke(this.memory) ?? invoke(this.persistent);
    const fromMemory = !this.ids.sessions.size ? [] : (method === "listSessions" ? markTemporary(invoke(this.memory)) : invoke(this.memory)) as unknown[];
    const fromFile = invoke(this.persistent) as unknown[];
    if (!fromMemory.length) return fromFile;
    if (method === "listSessions") return sortSessions([...fromMemory, ...fromFile] as Session[]);
    if (method === "searchMessages") return [...fromMemory, ...fromFile].slice(0, (args[1] as number | undefined) ?? 20);
    return [...fromMemory, ...fromFile];
  }

  private memoryCall(method: Method, args: unknown[], invoke: (repos: Repo) => unknown): unknown {
    if (method === "insertSession") this.adopt(args[0] as Session);
    if (method === "insertRun") this.ids.runs.add((args[0] as { id: string }).id);
    if (method === "insertMessage") this.ids.messages.add((args[0] as { id: string }).id);
    const result = invoke(this.memory);
    if (method === "deleteSession") this.ids.sessions.delete(args[0] as string);
    return method === "getSession" || method === "listSessions" ? markTemporary(result) : result;
  }

  /** The in-memory store needs the thread's workspace and project rows for its foreign keys. */
  private adopt(session: Session): void {
    this.ids.sessions.add(session.id);
    if (!this.memory.listWorkspaces().some((item) => item.id === session.workspaceId)) {
      const workspace = this.persistent.listWorkspaces().find((item) => item.id === session.workspaceId);
      if (workspace) this.memory.insertWorkspace(workspace);
    }
    if (!this.memory.getProject(session.projectId)) {
      const project = this.persistent.getProject(session.projectId);
      if (project) this.memory.insertProject(project);
    }
  }
}

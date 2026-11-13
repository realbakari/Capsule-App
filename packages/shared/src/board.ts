import type { Run, Session, WorkspaceMode } from "./types.js";

/**
 * The board is a view over threads, not a second store.
 *
 * A card is a thread. A draft card is a thread with no turns yet that holds
 * the prompt it will start with (`Session.pendingStart`). A card is done only
 * when the person says so (`Session.doneAt`): an agent finishing a turn makes
 * a card ready for review, not finished work, so nothing chained behind it
 * moves until someone has looked.
 */

export interface PendingStart {
  prompt: string;
  /** Cards that must be marked done before this one may start. */
  dependsOn: string[];
  /** Start on its own once every card it depends on is done. */
  autoStart: boolean;
  createdAt: string;
  /** Why the last attempt to start it did not go out; nothing was sent. */
  error?: string;
}

export type BoardColumnId = "draft" | "queued" | "running" | "needs-you" | "review" | "done";

export const BOARD_COLUMNS: ReadonlyArray<{ id: BoardColumnId; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "needs-you", label: "Needs you" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

export type BoardRun = Pick<Run, "status" | "error"> & { hasResult?: boolean; result?: string };

export interface BoardBlocker {
  id: string;
  title: string;
  status: "failed" | "cancelled";
}

export type BoardCardState =
  | { column: "draft" }
  | { column: "queued"; waitingOn: string[] }
  | { column: "running" }
  | { column: "needs-you"; reason: "approval" }
  | { column: "needs-you"; reason: "failed" }
  | { column: "needs-you"; reason: "blocked"; blockedBy: BoardBlocker[] }
  | { column: "review" }
  | { column: "done" };

export interface BoardContext {
  sessions: ReadonlyMap<string, Session>;
  latestRuns: ReadonlyMap<string, BoardRun>;
  /** A live agent turn the run record has not caught up with yet. */
  isWorking?: (session: Session) => boolean;
}

/*
 * Capsule's own contract verdicts: the app judging a turn against the
 * contract it wrote for itself, not the agent reporting a problem. A turn
 * with one of these did not fail in any sense a person cares about.
 */
const INTERNAL_VERDICTS = new Set(["verification failed", "empty result", "completed"]);

/** Whether a stored run error is one of those verdicts rather than a real fault. */
export function isInternalVerdict(message: string | undefined): boolean {
  return Boolean(message && INTERNAL_VERDICTS.has(message.trim().toLowerCase()));
}

function failed(run: BoardRun): boolean {
  return run.status === "failed" && !(run.hasResult ?? Boolean(run.result?.trim())) && !isInternalVerdict(run.error);
}

export type DependencyState = "done" | "pending" | "missing" | BoardBlocker;

/** Where one prerequisite stands. A failed or stopped turn will not finish on its own. */
export function dependencyState(id: string, context: BoardContext): DependencyState {
  const session = context.sessions.get(id);
  if (!session) return "missing";
  if (session.doneAt) return "done";
  if (session.pendingStart) return "pending";
  const run = context.latestRuns.get(id);
  if (run?.status === "cancelled") return { id, title: session.title, status: "cancelled" };
  if (run && failed(run)) return { id, title: session.title, status: "failed" };
  return "pending";
}

/**
 * Which column a thread belongs in, or undefined for a thread with nothing to
 * show: no turns and no prompt waiting.
 */
export function boardCardState(session: Session, context: BoardContext): BoardCardState | undefined {
  if (session.pendingStart) {
    const waitingOn: string[] = [];
    const blockedBy: BoardBlocker[] = [];
    for (const id of session.pendingStart.dependsOn) {
      const state = dependencyState(id, context);
      if (state === "pending") waitingOn.push(id);
      else if (typeof state === "object") blockedBy.push(state);
    }
    if (blockedBy.length > 0) return { column: "needs-you", reason: "blocked", blockedBy };
    if (waitingOn.length > 0) return { column: "queued", waitingOn };
    return { column: "draft" };
  }
  if (session.doneAt) return { column: "done" };
  const run = context.latestRuns.get(session.id);
  if (run?.status === "approval_required" || run?.status === "blocked") return { column: "needs-you", reason: "approval" };
  if (context.isWorking?.(session) || run?.status === "running" || run?.status === "queued" || run?.status === "waiting") {
    return { column: "running" };
  }
  if (!run) return undefined;
  if (failed(run)) return { column: "needs-you", reason: "failed" };
  return { column: "review" };
}

export interface BoardCard {
  session: Session;
  state: BoardCardState;
}

/** Cards grouped by column, in column order, each column most recently changed first. */
export function groupBoardCards(
  sessions: readonly Session[],
  context: BoardContext,
): Array<{ id: BoardColumnId; label: string; cards: BoardCard[] }> {
  const columns = BOARD_COLUMNS.map((column) => ({ ...column, cards: [] as BoardCard[] }));
  const index = new Map(columns.map((column) => [column.id, column]));
  for (const session of sessions) {
    if (session.state !== "active") continue;
    const state = boardCardState(session, context);
    if (state) index.get(state.column)!.cards.push({ session, state });
  }
  for (const column of columns) {
    column.cards.sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt)
      || left.session.id.localeCompare(right.session.id));
  }
  return columns;
}

/** A draft that should start now, without anyone pressing anything. */
export function readyToAutoStart(session: Session, context: BoardContext): boolean {
  const pending = session.pendingStart;
  if (!pending?.autoStart || pending.error || session.state !== "active" || pending.dependsOn.length === 0) return false;
  // A deleted prerequisite was never marked done, so it starts nothing.
  return pending.dependsOn.every((id) => dependencyState(id, context) === "done");
}

/**
 * Whether making `cardId` wait for `dependsOnId` would close a loop.
 * Only drafts carry links, so the walk follows `pendingStart.dependsOn`.
 */
export function createsDependencyCycle(
  sessions: ReadonlyMap<string, Pick<Session, "pendingStart">>,
  cardId: string,
  dependsOnId: string,
): boolean {
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === cardId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(sessions.get(id)?.pendingStart?.dependsOn ?? []));
  }
  return false;
}

export interface CreateBoardCardInput {
  projectId: string;
  title?: string;
  prompt: string;
  agentId?: string;
  workspaceMode?: WorkspaceMode;
  dependsOn: string[];
  autoStart: boolean;
  /** Send the prompt now instead of keeping a draft. */
  start?: boolean;
}

export type BoardCardOp =
  | { type: "edit"; prompt?: string; autoStart?: boolean }
  | { type: "link"; dependsOn: string }
  | { type: "unlink"; dependsOn: string }
  /** Send the draft's prompt now, whatever it was waiting for. */
  | { type: "start" }
  | { type: "done" }
  | { type: "reopen" };

export const BOARD_PROMPT_LIMIT = 200_000;
export const BOARD_DEPENDENCY_LIMIT = 16;

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function ids(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > BOARD_DEPENDENCY_LIMIT) return undefined;
  const out = value.map((item) => text(item, 256));
  return out.every((item): item is string => Boolean(item)) ? [...new Set(out as string[])] : undefined;
}

/** Validate a card that arrived over IPC. Returns undefined for anything malformed. */
export function readCreateBoardCard(value: unknown): CreateBoardCardInput | undefined {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object") return undefined;
  const projectId = text(input.projectId, 256);
  const prompt = text(input.prompt, BOARD_PROMPT_LIMIT);
  const dependsOn = ids(input.dependsOn ?? []);
  const title = input.title === undefined ? undefined : text(input.title, 500);
  const agentId = input.agentId === undefined ? undefined : text(input.agentId, 256);
  const workspaceMode = input.workspaceMode === "local" || input.workspaceMode === "worktree" ? input.workspaceMode : undefined;
  if (!projectId || !prompt?.trim() || !dependsOn) return undefined;
  if ((input.title !== undefined && title === undefined) || (input.agentId !== undefined && !agentId)) return undefined;
  if (input.workspaceMode !== undefined && !workspaceMode) return undefined;
  return {
    projectId,
    prompt,
    dependsOn,
    autoStart: input.autoStart === true,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(agentId ? { agentId } : {}),
    ...(workspaceMode ? { workspaceMode } : {}),
    ...(input.start === true ? { start: true } : {}),
  };
}

/** Validate a card change that arrived over IPC. */
export function readBoardCardOp(value: unknown): BoardCardOp | undefined {
  const op = value as Record<string, unknown> | null;
  if (!op || typeof op !== "object") return undefined;
  switch (op.type) {
    case "edit": {
      const prompt = op.prompt === undefined ? undefined : text(op.prompt, BOARD_PROMPT_LIMIT);
      if (op.prompt !== undefined && !prompt?.trim()) return undefined;
      if (op.autoStart !== undefined && typeof op.autoStart !== "boolean") return undefined;
      return { type: "edit", ...(prompt ? { prompt } : {}), ...(typeof op.autoStart === "boolean" ? { autoStart: op.autoStart } : {}) };
    }
    case "link":
    case "unlink": {
      const dependsOn = text(op.dependsOn, 256);
      return dependsOn ? { type: op.type, dependsOn } : undefined;
    }
    case "start":
    case "done":
    case "reopen":
      return { type: op.type };
    default:
      return undefined;
  }
}

/** Parse the stored column, dropping anything that is not a pending start. */
export function readPendingStart(raw: string | null | undefined): PendingStart | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<PendingStart> | null;
    if (!value || typeof value.prompt !== "string" || typeof value.createdAt !== "string") return undefined;
    const dependsOn = Array.isArray(value.dependsOn) ? value.dependsOn.filter((id): id is string => typeof id === "string") : [];
    return {
      prompt: value.prompt,
      dependsOn,
      autoStart: value.autoStart === true,
      createdAt: value.createdAt,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  } catch {
    return undefined;
  }
}

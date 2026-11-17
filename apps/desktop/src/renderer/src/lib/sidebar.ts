import { isInternalVerdict } from "./thread-error.js";
import { threadShelf, type Run, type Session } from "@capsule/shared";

export type SidebarGrouping = "project" | "status" | "recent" | "tag";
export const SIDEBAR_GROUPING_KEY = "capsule.sidebarGrouping";

export function readSidebarGrouping(read: () => string | null): SidebarGrouping {
  try {
    const stored = read();
    return stored === "status" || stored === "recent" || stored === "tag" ? stored : "project";
  }
  catch { return "project"; }
}

/** Folded projects and each project's "Show more" depth, kept across launches. */
export const SIDEBAR_FOLDED_KEY = "capsule.sidebarFolded";
export const SIDEBAR_SHOW_MORE_KEY = "capsule.sidebarShowMore";

export function readFoldedProjects(read: () => string | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(read() ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  }
  catch { return new Set(); }
}

export function readShowMore(read: () => string | null): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(read() ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0));
  }
  catch { return {}; }
}

/**
 * When a thread last had a turn: its latest run's start or finish, or its
 * creation when it has none. Lists sort on this rather than `updatedAt`,
 * which every rename, pin and setting change moves.
 */
export function threadActivityAt(session: Pick<Session, "createdAt">, run?: Pick<Run, "createdAt" | "completedAt">): string {
  let latest = session.createdAt ?? "";
  for (const time of [run?.createdAt, run?.completedAt]) if (time && time > latest) latest = time;
  return latest;
}

export function latestSidebarRuns(runs: readonly Run[]): Map<string, Run> {
  const latest = new Map<string, Run>();
  for (const run of runs) {
    const previous = latest.get(run.sessionId);
    if (!previous || run.createdAt > previous.createdAt) latest.set(run.sessionId, run);
  }
  return latest;
}

export type SidebarStatusGroupId = "attention" | "working" | "review" | "other" | "snoozed" | "settled";
export interface SidebarStatusGroup {
  id: SidebarStatusGroupId;
  label: string;
  threads: Session[];
}

/** Group only lightweight summaries; a settled row does not imply verification. */
export function groupSidebarThreads(
  sessions: readonly Session[],
  projects: readonly { id: string; name: string }[],
  latestRuns: ReadonlyMap<string, Run>,
  query = "",
): SidebarStatusGroup[] {
  const groups: SidebarStatusGroup[] = [
    { id: "attention", label: "Needs you", threads: [] },
    { id: "working", label: "Working", threads: [] },
    { id: "review", label: "Ready for review", threads: [] },
    { id: "other", label: "Other conversations", threads: [] },
    { id: "snoozed", label: "Snoozed", threads: [] },
    { id: "settled", label: "Settled", threads: [] },
  ];
  const now = Date.now();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const seen = new Set<string>();
  const needle = query.trim().toLowerCase();
  for (const session of sessions) {
    const projectName = projectNames.get(session.projectId);
    if (session.state !== "active" || projectName === undefined || seen.has(session.id)) continue;
    seen.add(session.id);
    if (needle && !session.title.toLowerCase().includes(needle) && !projectName.toLowerCase().includes(needle)) continue;
    const run = latestRuns.get(session.id);
    const answered = run?.hasResult ?? Boolean(run?.result?.trim());
    const kind = resolveSidebarThreadKind({
      liveHarness: isWorkingHarnessState(session.harnessState),
      runStatus: run?.status, runAnswered: answered, runError: run?.error,
    });
    // Work in flight or waiting on a decision is never hidden by a shelf.
    const shelf = kind === "approval" || kind === "working" ? "active" : threadShelf(session, now);
    const group = shelf === "snoozed" ? groups[4]!
      : shelf === "settled" ? groups[5]!
      : kind === "approval" || kind === "failed" ? groups[0]!
      : kind === "working" ? groups[1]!
      : run?.status === "completed" && answered ? groups[2]! : groups[3]!;
    group.threads.push(session);
  }
  const activity = (session: Session) => threadActivityAt(session, latestRuns.get(session.id));
  for (const group of groups) {
    group.threads.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || activity(b).localeCompare(activity(a)) || a.id.localeCompare(b.id));
  }
  return groups.filter((group) => group.threads.length);
}

export const STATUS_THREAD_PREVIEW = 20;

/** Shelves stay folded until opened; the selected thread is the one exception. */
export const SHELF_GROUPS: ReadonlySet<SidebarStatusGroupId> = new Set(["snoozed", "settled"]);

export function visibleStatusThreads(group: SidebarStatusGroup, expanded: boolean, selectedId?: string): Session[] {
  if (expanded || group.id === "attention" || group.id === "working") return group.threads;
  if (SHELF_GROUPS.has(group.id)) return group.threads.filter((session) => session.id === selectedId);
  const selectedIndex = group.threads.findIndex((session) => session.id === selectedId);
  return group.threads.slice(0, Math.max(STATUS_THREAD_PREVIEW, selectedIndex + 1));
}

export type SidebarThreadKind = "working" | "approval" | "failed" | "ready";

/** A collapsed project must not hide a waiting decision behind another turn. */
export function resolveProjectThreadKind(kinds: readonly SidebarThreadKind[]): SidebarThreadKind | undefined {
  for (const kind of ["approval", "working", "failed"] as const) {
    if (kinds.includes(kind)) return kind;
  }
  return undefined;
}

/** In-flight ACP only. `waiting` is an idle persistent session, not work. */
export function isWorkingHarnessState(state: string | undefined): boolean {
  return state === "running" || state === "spawning";
}

export function latestRunForSession<T extends { sessionId: string; createdAt: string }>(
  runs: readonly T[],
  sessionId: string,
): T | undefined {
  let latest: T | undefined;
  for (const run of runs) {
    if (run.sessionId !== sessionId) continue;
    if (!latest || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

export function resolveSidebarThreadKind(input: {
  liveHarness: boolean;
  runStatus?: string;
  /** Whether that run left an answer behind. */
  runAnswered?: boolean;
  /** The error that run stored, if it stored one. */
  runError?: string;
}): SidebarThreadKind {
  if (input.runStatus === "approval_required" || input.runStatus === "blocked") return "approval";
  if (
    input.liveHarness ||
    input.runStatus === "running" ||
    input.runStatus === "queued" ||
    input.runStatus === "waiting"
  ) {
    return "working";
  }
  // A turn that answered is not a failed thread, whatever a later check
  // decided about it — nor is one whose only complaint is Capsule's own
  // contract verdict. The thread reads the same way: see `threadError`.
  if (
    input.runStatus === "failed" &&
    !input.runAnswered &&
    !isInternalVerdict(input.runError)
  ) {
    return "failed";
  }
  return "ready";
}

export function compactRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function shouldRecedeThread(kind: SidebarThreadKind, isActive: boolean): boolean {
  if (isActive) return false;
  return kind === "ready";
}

export const SETTLED_THREAD_PREVIEW = 3;

export function splitProjectThreads<T extends { pinned?: boolean; settledAt?: string; snoozedUntil?: string }>(
  threads: readonly T[],
  kindOf: (thread: T) => SidebarThreadKind,
  activityOf: (thread: T) => string,
  preview = SETTLED_THREAD_PREVIEW,
  selected?: T,
  now = Date.now(),
): {
  pinned: T[];
  live: T[];
  rest: T[];
  hidden: number;
  /** Threads the person called done, newest first; a shelf, folded by default. */
  shelvedSettled: T[];
  /** Threads hidden until a time, soonest wake first. */
  shelvedSnoozed: T[];
} {
  const pinned: T[] = [];
  const live: T[] = [];
  const settled: T[] = [];
  const shelvedSettled: T[] = [];
  const shelvedSnoozed: T[] = [];
  for (const thread of threads) {
    const kind = kindOf(thread);
    const busy = kind === "working" || kind === "approval";
    const shelf = busy ? "active" : threadShelf(thread, now);
    if (shelf === "snoozed") shelvedSnoozed.push(thread);
    else if (shelf === "settled") shelvedSettled.push(thread);
    else if (thread.pinned) pinned.push(thread);
    else if (busy) live.push(thread);
    else settled.push(thread);
  }
  shelvedSettled.sort((left, right) => ((left.settledAt ?? "") < (right.settledAt ?? "") ? 1 : -1));
  shelvedSnoozed.sort((left, right) => ((left.snoozedUntil ?? "") < (right.snoozedUntil ?? "") ? -1 : 1));
  settled.sort((left, right) => activityOf(right).localeCompare(activityOf(left)));
  const rest = settled.slice(0, preview);
  if (selected && settled.includes(selected) && !rest.includes(selected)) rest.push(selected);
  return {
    pinned,
    live,
    rest,
    hidden: settled.length - rest.length,
    shelvedSettled,
    shelvedSnoozed,
  };
}

/** Index once per snapshot rather than scanning every thread for each project. */
export function indexSidebarThreads(sessions: readonly Session[]) {
  const byProject = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.state !== "active") continue;
    const list = byProject.get(session.projectId);
    if (list) list.push(session);
    else byProject.set(session.projectId, [session]);
  }
  return byProject;
}

/**
 * The pinned order Undo puts back after an unpin: the order from before it,
 * with anything pinned in the meantime kept after, in its own order.
 */
export function restoredPinOrder(before: readonly string[], pinnedNow: readonly { id: string; pinOrder?: number }[]): string[] {
  const rank = (item: { id: string; pinOrder?: number }) => {
    const index = before.indexOf(item.id);
    return index < 0 ? before.length + (item.pinOrder ?? Number.MAX_SAFE_INTEGER) : index;
  };
  return [...pinnedNow].sort((a, b) => rank(a) - rank(b)).map((item) => item.id);
}

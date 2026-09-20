import { isInternalVerdict } from "./thread-error.js";
import type { Run, Session } from "@capsule/shared";

export type SidebarGrouping = "project" | "status";
export const SIDEBAR_GROUPING_KEY = "capsule.sidebarGrouping";

export function readSidebarGrouping(read: () => string | null): SidebarGrouping {
  try { return read() === "status" ? "status" : "project"; }
  catch { return "project"; }
}

export function latestSidebarRuns(runs: readonly Run[]): Map<string, Run> {
  const latest = new Map<string, Run>();
  for (const run of runs) {
    const previous = latest.get(run.sessionId);
    if (!previous || run.createdAt > previous.createdAt) latest.set(run.sessionId, run);
  }
  return latest;
}

export type SidebarStatusGroupId = "attention" | "working" | "review" | "other";
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
  ];
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
    const group = kind === "approval" || kind === "failed" ? groups[0]!
      : kind === "working" ? groups[1]!
      : run?.status === "completed" && answered ? groups[2]! : groups[3]!;
    group.threads.push(session);
  }
  for (const group of groups) {
    group.threads.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  return groups.filter((group) => group.threads.length);
}

export const STATUS_THREAD_PREVIEW = 20;

export function visibleStatusThreads(group: SidebarStatusGroup, expanded: boolean, selectedId?: string): Session[] {
  if (expanded || group.id === "attention" || group.id === "working") return group.threads;
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

export const SETTLED_THREAD_PREVIEW = 8;

export function splitProjectThreads<T extends { pinned?: boolean; updatedAt: string }>(
  threads: readonly T[],
  kindOf: (thread: T) => SidebarThreadKind,
  preview = SETTLED_THREAD_PREVIEW,
): {
  pinned: T[];
  live: T[];
  rest: T[];
  hidden: number;
} {
  const pinned = threads.filter((thread) => thread.pinned);
  const unpinned = threads.filter((thread) => !thread.pinned);
  const live: T[] = [];
  const settled: T[] = [];
  for (const thread of unpinned) {
    const kind = kindOf(thread);
    if (kind === "working" || kind === "approval") live.push(thread);
    else settled.push(thread);
  }
  settled.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  return {
    pinned,
    live,
    rest: settled.slice(0, preview),
    hidden: Math.max(0, settled.length - preview),
  };
}

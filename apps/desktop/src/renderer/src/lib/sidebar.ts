export type SidebarThreadKind = "working" | "approval" | "failed" | "ready";

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
  if (input.runStatus === "failed") return "failed";
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

import type { Run, Session, ThreadGroup } from "@capsule/shared";

/** Asked for from the command palette before the composer is on screen. */
export const RUN_ON_EVENT = "capsule:run-on";
let runOnRequested = false;

export function requestRunOn(): void {
  runOnRequested = true;
  window.dispatchEvent(new CustomEvent(RUN_ON_EVENT));
}

export function takeRunOnRequest(): boolean {
  const requested = runOnRequested;
  runOnRequested = false;
  return requested;
}

export type SidebarEntry =
  | { kind: "thread"; session: Session }
  | { kind: "group"; group: ThreadGroup; sessions: Session[] };

/**
 * The sidebar's thread lists with each comparison folded into one row. The
 * row sits where its first candidate would have, and takes every candidate
 * in `pool` (the project's threads, including any past the "Show more" cut)
 * with it, so a group never splits between Pinned, Working and the rest.
 */
export function foldComparisons(lists: readonly Session[][], groups: ReadonlyMap<string, ThreadGroup>, pool: readonly Session[] = lists.flat()): SidebarEntry[][] {
  const members = new Map<string, Session[]>();
  for (const session of pool) {
    if (!session.groupId || !groups.has(session.groupId)) continue;
    members.set(session.groupId, [...(members.get(session.groupId) ?? []), session]);
  }
  const placed = new Set<string>();
  return lists.map((list) => list.flatMap((session): SidebarEntry[] => {
    const group = session.groupId ? groups.get(session.groupId) : undefined;
    if (!group) return [{ kind: "thread", session }];
    if (placed.has(group.id)) return [];
    placed.add(group.id);
    const order = new Map(group.candidates.map((candidate, index) => [candidate.sessionId, index]));
    const sessions = [...(members.get(group.id) ?? [session])].sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));
    return [{ kind: "group", group, sessions }];
  }));
}

const ACTIVE = new Set<Run["status"]>(["queued", "running", "waiting"]);

/** The group row's one-line state: how many agents, and what needs attention. */
export function comparisonStatus(group: ThreadGroup, sessions: readonly Session[], latestRuns: ReadonlyMap<string, Pick<Run, "status">>, agentName: (session: Session) => string): string {
  const winner = sessions.find((session) => session.id === group.winnerSessionId);
  if (winner) return `Kept ${agentName(winner)}`;
  const statuses = sessions.map((session) => latestRuns.get(session.id)?.status);
  const working = statuses.filter((status) => !status || ACTIVE.has(status)).length;
  const waiting = statuses.filter((status) => status === "approval_required" || status === "blocked").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const parts = [`${sessions.length} agents`];
  if (working) parts.push(`${working} working`);
  if (waiting) parts.push(`${waiting} need you`);
  if (failed) parts.push(`${failed} failed`);
  if (!working && !waiting) parts.push("ready to compare");
  return parts.join(" · ");
}

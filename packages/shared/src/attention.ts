import type { Run, Session } from "./types.js";

/**
 * What is waiting for you, across every thread.
 *
 * Capsule can have a dozen threads running agents that each take minutes, and
 * nothing said which of them wanted something. The sidebar counted pending
 * approvals and the menu bar extra held a menu that never changed, so the only
 * way to find the thread that had stopped for a decision was to open them.
 *
 * The states are the ones that matter to a person who has looked away, in the
 * order they matter:
 *
 *   needs-input  a decision is blocking the turn — nothing moves until you act
 *   blocked      it stopped and will not resume on its own
 *   ready        it finished while you were elsewhere
 *   running      it is working; nothing is required of you
 *
 * Pure, so the menu bar, a floating window and a test all read the same thing.
 */

export type AttentionState = "needs-input" | "blocked" | "ready" | "running";

/** Highest need first; this order is the whole point of the type. */
export const ATTENTION_ORDER: AttentionState[] = ["needs-input", "blocked", "ready", "running"];

const RANK: Record<AttentionState, number> = {
  "needs-input": 0,
  blocked: 1,
  ready: 2,
  running: 3,
};

export interface AttentionItem {
  sessionId: string;
  title: string;
  state: AttentionState;
  /** When the run last changed, for ordering within a state. */
  at: string;
}

export interface AttentionSummary {
  /** Threads wanting something, most urgent first. */
  items: AttentionItem[];
  /** The state to show when only one thing can be shown. */
  state?: AttentionState;
  counts: Record<AttentionState, number>;
}

function stateOf(run: Run): AttentionState | undefined {
  switch (run.status) {
    case "approval_required":
      return "needs-input";
    case "failed":
    case "blocked":
      return "blocked";
    case "completed":
      return "ready";
    case "running":
    case "queued":
    case "waiting":
      return "running";
    default:
      // cancelled and stopped are settled and asked nothing of anyone.
      return undefined;
  }
}

export interface AttentionInput {
  sessions: Session[];
  runs: Run[];
  /** Threads the person is looking at, which are not waiting for them. */
  activeSessionId?: string;
  /** Threads already seen since their last change. */
  seenSessionIds?: ReadonlySet<string>;
}

/**
 * The threads wanting attention, most urgent first.
 *
 * One entry per thread: a thread with three finished runs is one thing to look
 * at, not three. Where a thread is in more than one state, the most urgent
 * wins — a completed run does not cancel out an approval sitting behind it.
 */
export function summariseAttention(input: AttentionInput): AttentionSummary {
  const { sessions, runs, activeSessionId, seenSessionIds } = input;
  const titles = new Map(sessions.map((session) => [session.id, session.title]));
  const archived = new Set(
    sessions.filter((session) => session.state === "archived").map((session) => session.id),
  );

  const best = new Map<string, AttentionItem>();
  for (const run of runs) {
    const state = stateOf(run);
    if (!state) continue;
    if (archived.has(run.sessionId)) continue;
    /*
     * The thread on screen is not waiting for you — you are looking at it.
     * A finished run there is news you already have.
     */
    if (run.sessionId === activeSessionId && state !== "needs-input") continue;
    // "Ready" means finished and unread; once seen it is just history.
    if (state === "ready" && seenSessionIds?.has(run.sessionId)) continue;

    const at = run.completedAt ?? run.updatedAt ?? run.createdAt;
    const existing = best.get(run.sessionId);
    if (!existing || RANK[state] < RANK[existing.state] || (RANK[state] === RANK[existing.state] && at > existing.at)) {
      best.set(run.sessionId, {
        sessionId: run.sessionId,
        title: titles.get(run.sessionId) ?? "Untitled thread",
        state,
        at,
      });
    }
  }

  const items = [...best.values()].sort(
    (left, right) => RANK[left.state] - RANK[right.state] || right.at.localeCompare(left.at),
  );
  const counts: Record<AttentionState, number> = {
    "needs-input": 0,
    blocked: 0,
    ready: 0,
    running: 0,
  };
  for (const item of items) counts[item.state] += 1;

  return { items, state: items[0]?.state, counts };
}

/** One line for a menu bar or a tooltip, or nothing when nothing is waiting. */
export function attentionLabel(summary: AttentionSummary): string | undefined {
  const { counts } = summary;
  const parts: string[] = [];
  if (counts["needs-input"] > 0) parts.push(`${counts["needs-input"]} needs input`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.ready > 0) parts.push(`${counts.ready} ready`);
  if (parts.length === 0 && counts.running > 0) parts.push(`${counts.running} running`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

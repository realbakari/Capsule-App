import type { GitPullRequest } from "./types.js";

/**
 * The last pull request Capsule read for a worktree thread's branch. Kept on
 * the thread so the sidebar can show it for every thread, not only the one on
 * screen, without asking GitHub for each of them.
 */
export interface ThreadPullRequest {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  checks?: GitPullRequest["checks"];
  /** When Capsule read it. */
  seenAt: string;
}

export type PullRequestBadgeKind = "open" | "draft" | "merged" | "closed" | "failing";

export interface PullRequestBadge {
  kind: PullRequestBadgeKind;
  label: string;
  /** Number and state in words, for a tooltip and a screen reader. */
  title: string;
}

export function toThreadPullRequest(pullRequest: GitPullRequest, seenAt: string): ThreadPullRequest {
  return {
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    isDraft: Boolean(pullRequest.isDraft),
    ...(pullRequest.checks ? { checks: pullRequest.checks } : {}),
    seenAt,
  };
}

/** Whether a new reading says anything the stored one does not. */
export function samePullRequest(left: ThreadPullRequest | undefined, right: ThreadPullRequest | undefined): boolean {
  if (!left || !right) return left === right;
  return left.number === right.number && left.url === right.url && left.state === right.state
    && left.isDraft === right.isDraft && left.checks === right.checks;
}

const LABELS: Record<PullRequestBadgeKind, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  failing: "Checks failing",
};

/**
 * One state per pull request. A finished pull request says how it finished;
 * an open one says first whether its checks fail, because that is the one
 * that needs the user.
 */
export function pullRequestBadge(pullRequest: ThreadPullRequest | undefined): PullRequestBadge | undefined {
  if (!pullRequest) return undefined;
  const state = pullRequest.state.toUpperCase();
  const kind: PullRequestBadgeKind = state === "MERGED" ? "merged"
    : state === "CLOSED" ? "closed"
      : pullRequest.checks === "failure" ? "failing"
        : pullRequest.isDraft ? "draft"
          : "open";
  return { kind, label: LABELS[kind], title: `Pull request #${pullRequest.number} · ${LABELS[kind]}` };
}

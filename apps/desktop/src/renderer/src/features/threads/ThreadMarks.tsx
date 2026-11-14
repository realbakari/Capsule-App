import { pullRequestBadge, type Session } from "@capsule/shared";
import { GitMergeIcon, GitPullRequestIcon } from "../shell/icons";
import "./threads.css";

/** A worktree thread's pull request, as one small mark in its sidebar row. */
export function ThreadPullRequestMark({ session }: { session: Session }) {
  const badge = session.workspaceMode === "worktree" ? pullRequestBadge(session.pullRequest) : undefined;
  if (!badge) return null;
  const Icon = badge.kind === "merged" ? GitMergeIcon : GitPullRequestIcon;
  return (
    <span className={`thread-pr ${badge.kind}`} title={badge.title} aria-label={badge.title} data-pr-state={badge.kind}>
      <Icon size={11} />
    </span>
  );
}

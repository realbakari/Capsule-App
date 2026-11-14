import { pullRequestBadge, type Session } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { GitMergeIcon, GitPullRequestIcon } from "../shell/icons";
import { useThreadActions } from "./ThreadActions";
import "./threads.css";

/** A temporary thread says so in its sidebar row. */
export function ThreadTemporaryMark({ session }: { session: Session }) {
  if (!session.temporary) return null;
  return <small className="thread-temporary" title="Temporary: not saved, gone when Capsule quits">Temporary</small>;
}

/** Above the composer of a temporary thread: what that means, and the way to keep it. */
export function TemporaryThreadBanner() {
  const { session } = useWorkspace();
  const actions = useThreadActions();
  if (!session?.temporary) return null;
  return (
    <div className="temporary-banner" role="status">
      <span><strong>Temporary conversation.</strong> Not saved, with no checkpoints. It is gone when Capsule quits.</span>
      {actions.writable && <button type="button" className="chip" onClick={() => void actions.keep(session.id)}>Keep this conversation</button>}
    </div>
  );
}

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

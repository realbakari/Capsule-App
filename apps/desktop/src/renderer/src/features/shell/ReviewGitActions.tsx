import { useWorkspace } from "../../lib/workspace";
import { plural, pushBlocked, syncState } from "../../lib/git-plan";
import { ArrowDownIcon, CloudUploadIcon, GitMergeIcon, GitPullRequestIcon } from "./icons";
import { useGitActions } from "./use-git-actions";

/** Review's push, pull and pull-request row; the same rules as the header's commit menu. */
export function ReviewGitActions() {
  const { api, git, settings, gitPull, gitMergePullRequest } = useWorkspace();
  const actions = useGitActions();
  const sync = git?.isRepo ? syncState(git) : undefined;
  const blocked = sync ? pushBlocked(sync) : undefined;
  const desktop = api.isDesktop !== false;
  return (
    <div className="git-actions">
      {desktop && sync?.kind === "behind" ? (
        <button className="chip" type="button" onClick={() => void gitPull("ff-only")}>
          <ArrowDownIcon size={13} />Pull {sync.behind}
        </button>
      ) : null}
      {desktop && sync?.kind === "diverged" ? (
        <button className="chip" type="button" title={`${sync.ahead} ahead of ${sync.upstream}, ${sync.behind} behind`} onClick={() => void gitPull("rebase")}>
          <ArrowDownIcon size={13} />Rebase onto {sync.upstream}
        </button>
      ) : null}
      <button className="chip" type="button" disabled={Boolean(blocked)} title={blocked} onClick={() => void actions.push()}>
        <CloudUploadIcon size={13} />{sync?.kind === "publish" ? "Publish" : sync?.kind === "ahead" ? `Push ${plural(sync.ahead, "commit")}` : "Push"}
      </button>
      {git?.pullRequest && git.pullRequest.state === "OPEN" ? (
        <button className="chip" type="button" onClick={() => void gitMergePullRequest()}>
          <GitMergeIcon size={13} />Merge PR
        </button>
      ) : (
        <button
          className="chip"
          type="button"
          disabled={git?.ghAvailable === false}
          title={git?.ghAvailable === false ? "The GitHub CLI (gh) is not installed or not signed in." : undefined}
          onClick={() => void actions.createPullRequest()}
        >
          <GitPullRequestIcon size={13} />{settings?.prDraft ? "Draft PR" : "Pull request"}
        </button>
      )}
    </div>
  );
}

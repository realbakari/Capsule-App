import type { GitCommitScope } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { onDefaultBranch, plural, suggestBranch } from "../../lib/git-plan";

type Target = "current" | "default" | { branch: string; };
/** How the caller runs a piece of work: busy state, and what to do once it succeeds. */
export type GitRunner = (work: () => Promise<boolean>) => Promise<boolean>;
const direct: GitRunner = (work) => work();

/**
 * Push, commit-and-push and open-a-pull-request, each asking first on the
 * default branch. The question offers the safer road as well: the same work
 * on a new branch named from it. Every surface that pushes goes through here.
 */
export function useGitActions() {
  const { git, settings, session, setConfirm, gitCommit, gitPush, gitCreateBranch, gitCreatePullRequest } = useWorkspace();

  async function onBranch(target: Target, work: (toDefaultBranch: boolean) => Promise<boolean>): Promise<boolean> {
    if (typeof target === "object" && !await gitCreateBranch(target.branch)) return false;
    return work(target === "default");
  }

  /**
   * Runs the work through `run` now, or asks first when HEAD is the default
   * branch and runs the chosen work through `run` once answered. A question
   * resolves false straight away.
   */
  function guard(kind: "push" | "commit" | "pull-request", words: string | undefined, work: (target: Target) => Promise<boolean>, run: GitRunner): Promise<boolean> {
    if (!git || !onDefaultBranch(git)) return run(() => work("current"));
    const branch = git.branch!;
    const name = suggestBranch(settings?.branchPrefix, words || session?.title, [...git.branches, ...(git.remoteBranches ?? []).map((ref) => ref.slice(ref.indexOf("/") + 1))]);
    const choose = (target: Target) => () => {
      setConfirm(undefined);
      void run(() => work(target));
    };
    const where = git.pushRemote ? `${git.pushRemote}/${branch}` : branch;
    if (kind === "pull-request") {
      setConfirm({
        title: "Open the pull request from a new branch?",
        detail: `${branch} is the default branch, and a pull request needs a branch of its own. This moves your work to ${name} and opens the pull request from there.`,
        confirmLabel: `Create ${name}`,
        onConfirm: choose({ branch: name }),
      });
      return Promise.resolve(false);
    }
    const ahead = git.ahead ?? 0;
    setConfirm({
      title: kind === "commit" ? `Commit and push to ${branch}?` : `Push to ${branch}?`,
      detail: kind === "commit"
        ? `${branch} is the default branch, so this commit goes straight to ${where}. A new branch keeps it off ${branch} until it is reviewed.`
        : `${branch} is the default branch, so ${ahead ? plural(ahead, "commit") : "this"} goes straight to ${where}. A new branch keeps ${ahead === 1 ? "it" : "them"} off ${branch} until reviewed.`,
      confirmLabel: `Push to ${branch}`,
      secondary: { label: kind === "commit" ? `Commit on ${name}` : `Push to ${name}`, onConfirm: choose({ branch: name }) },
      onConfirm: choose("default"),
    });
    return Promise.resolve(false);
  }

  return {
    push: (run: GitRunner = direct) =>
      guard("push", undefined, (target) => onBranch(target, (toDefaultBranch) => gitPush({ toDefaultBranch })), run),
    commitAndPush: (message: string, scope: GitCommitScope, run: GitRunner = direct) =>
      guard("commit", message, (target) => onBranch(target, async (toDefaultBranch) =>
        await gitCommit(message, scope) && gitPush({ toDefaultBranch })), run),
    createPullRequest: (title?: string, run: GitRunner = direct) =>
      guard("pull-request", title, (target) => onBranch(target, () => gitCreatePullRequest(title ? { title } : undefined)), run),
  };
}

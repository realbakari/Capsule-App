import type { GitRefName } from "@capsule/shared";
import { git, inRepository } from "./git-process.js";
import { remoteCommandFailure } from "./remote-errors.js";
import { BASE_FETCH_TIMEOUT_MS, fetchBranchArgs } from "./worktrees.js";

/** Hidden ref a pull request's head is fetched into: outside branch and tag lists, like checkpoints. */
export function pullRequestRef(number: number): GitRefName {
  return `refs/capsule/pull/${number}` as GitRefName;
}

/** The host's own `refs/pull/<n>/head`, which exists for forks and same-repository branches alike. */
export function fetchPullRequestArgs(remote: string, number: number): string[] {
  if (!Number.isInteger(number) || number < 1) throw new Error("A pull request number is a positive whole number.");
  return ["fetch", "--no-tags", remote, `+refs/pull/${number}/head:${pullRequestRef(number)}`];
}

export type FetchedPullRequest =
  | {
    ok: true;
    remote: string;
    /** The hidden ref holding the head commit. */
    ref: GitRefName;
    commit: string;
    /** Set when the head branch lives in this repository at the same commit, so a push can update the pull request. */
    upstream?: string;
  }
  | { ok: false; detail: string };

export function pullRequestFetchFailure(number: number, stderr: string): string {
  if (/couldn't find remote ref|no such ref|not our ref/i.test(stderr)) {
    return `origin has no pull request #${number}. It may have been deleted, or origin is not the repository it was opened on.`;
  }
  return remoteCommandFailure(stderr, `Could not fetch pull request #${number} from origin.`);
}

export async function fetchPullRequest(repository: string, number: number, headRefName?: GitRefName): Promise<FetchedPullRequest> {
  return inRepository(repository, async () => {

    const listed = await git(repository, ["remote"]);
    if (!listed.stdout.split(/\r?\n/).map((item) => item.trim()).includes("origin")) {
      return { ok: false, detail: "This project has no origin remote to fetch the pull request from." };
    }
    const fetched = await git(repository, fetchPullRequestArgs("origin", number), process.env, BASE_FETCH_TIMEOUT_MS * 2);
    if (!fetched.ok) return { ok: false, detail: pullRequestFetchFailure(number, fetched.stderr) };
    const ref = pullRequestRef(number);
    const commit = (await git(repository, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).stdout.trim();
    if (!commit) return { ok: false, detail: `Pull request #${number} was fetched but its head commit could not be read.` };
    let upstream: string | undefined;
    if (headRefName) {
      // A fork's branch is not on origin, or is a different branch that
      // happens to share the name; either way it is not this PR's to push to.
      const branch = await git(repository, fetchBranchArgs("origin", headRefName), process.env, BASE_FETCH_TIMEOUT_MS);
      const tip = branch.ok ? (await git(repository, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${headRefName}^{commit}`])).stdout.trim() : "";
      if (tip === commit) upstream = `origin/${headRefName}`;
    }
    return { ok: true, remote: "origin", ref, commit, ...(upstream ? { upstream } : {}) };

  });
}

/** First free name among `base`, `base-2`, `base-3`… */
export async function availableBranchName(repository: string, base: string): Promise<string> {
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await git(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).ok) return name;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Check the pull request out in the project folder itself. Refused on a
 * dirty tree: switching would carry those edits onto someone else's branch.
 */
export async function checkoutPullRequestLocally(
  repository: string,
  fetched: Extract<FetchedPullRequest, { ok: true }>,
  branch: string,
): Promise<{ ok: boolean; detail: string; branch?: string }> {
  return inRepository(repository, async () => {

    const status = await git(repository, ["status", "--porcelain"]);
    if (!status.ok) return { ok: false, detail: status.stderr || "Could not read the project folder's Git status." };
    if (status.stdout.trim()) {
      return { ok: false, detail: "The project folder has uncommitted changes. Commit or stash them, or check the pull request out in a worktree instead." };
    }
    let name = branch;
    if ((await git(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok) {
      // An earlier checkout of the same pull request. Reuse it, unless a
      // worktree holds it, in which case this checkout gets its own name.
      const switched = await git(repository, ["switch", "--no-guess", branch]);
      if (switched.ok) {
        const at = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
        return {
          ok: true,
          branch,
          detail: at === fetched.commit ? `Switched to ${branch}.` : `Switched to the existing ${branch}, which is not at the pull request's latest commit.`,
        };
      }
      name = await availableBranchName(repository, branch);
    }
    const created = await git(repository, ["switch", "--no-track", "-c", name, fetched.commit]);
    if (!created.ok) return { ok: false, detail: created.stderr || `Could not create ${name}.` };
    if (fetched.upstream && name === branch) await git(repository, ["branch", `--set-upstream-to=${fetched.upstream}`, name]);
    return { ok: true, branch: name, detail: `Checked out ${name}.` };

  });
}

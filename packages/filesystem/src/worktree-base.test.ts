import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGitRefName, type GitRefName } from "@capsule/shared";
import { createWorktree, defaultWorktreeBase, fetchBranchArgs, listWorktreeBases, rebaseFreshWorktree, splitRemoteRef } from "./worktrees.js";
import { checkoutPullRequestLocally, fetchPullRequest, fetchPullRequestArgs, pullRequestFetchFailure } from "./pull-request-checkout.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function ref(name: string): GitRefName {
  const parsed = parseGitRefName(name);
  if (!parsed) throw new Error(`invalid ref ${name}`);
  return parsed;
}
function commit(cwd: string, file: string, text: string) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", `write ${file}`);
  return git(cwd, "rev-parse", "HEAD");
}

/** A clone of a bare "origin" whose main is ahead of the clone's stale feature checkout. */
function fixture() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-base-"));
  roots.push(top);
  const origin = path.join(top, "origin.git");
  const seed = path.join(top, "seed");
  git(top, "init", "--bare", "-b", "main", origin);
  git(top, "init", "-b", "main", seed);
  git(seed, "config", "user.email", "fixture@example.test");
  git(seed, "config", "user.name", "Capsule Test");
  commit(seed, "README.md", "one\n");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const clone = path.join(top, "clone");
  git(top, "clone", "-q", origin, clone);
  git(clone, "config", "user.email", "fixture@example.test");
  git(clone, "config", "user.name", "Capsule Test");
  git(clone, "switch", "-q", "-c", "stale-feature");
  commit(clone, "feature.txt", "stale\n");
  const upstreamTip = commit(seed, "README.md", "two\n");
  git(seed, "push", "-q", "origin", "main");
  return { top, origin, seed, clone, upstreamTip };
}

describe("worktree base branch", { timeout: 30_000 }, () => {
  it("defaults to the remote default branch and fetches it before branching", async () => {
    const { top, clone, upstreamTip } = fixture();
    expect(await defaultWorktreeBase(clone)).toBe("origin/main");
    const created = await createWorktree(clone, path.join(top, "wt-default"), "capsule/one");
    expect(created).toMatchObject({ ok: true, baseRef: "origin/main" });
    expect(git(path.join(top, "wt-default"), "rev-parse", "HEAD")).toBe(upstreamTip);
    expect(fs.existsSync(path.join(top, "wt-default", "feature.txt"))).toBe(false);
    // No upstream: a push from the thread's branch must not aim at main.
    expect(() => git(path.join(top, "wt-default"), "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  it("falls back to HEAD when there is no remote", async () => {
    const { top, seed } = fixture();
    git(seed, "remote", "remove", "origin");
    expect(await defaultWorktreeBase(seed)).toBe("HEAD");
    const created = await createWorktree(seed, path.join(top, "wt-head"), "capsule/two");
    expect(created).toMatchObject({ ok: true, baseRef: "HEAD" });
    expect(git(path.join(top, "wt-head"), "rev-parse", "HEAD")).toBe(git(seed, "rev-parse", "HEAD"));
    expect((await listWorktreeBases(seed)).remote).toBeUndefined();
  });

  it("uses origin/main when origin/HEAD was never set", async () => {
    const { seed } = fixture();
    git(seed, "fetch", "-q", "origin");
    expect(await defaultWorktreeBase(seed)).toBe("origin/main");
  });

  it("branches from a chosen local branch and refuses an unknown one", async () => {
    const { top, clone } = fixture();
    const created = await createWorktree(clone, path.join(top, "wt-local"), "capsule/three", { baseRef: ref("stale-feature") });
    expect(created).toMatchObject({ ok: true, baseRef: "stale-feature" });
    expect(fs.readFileSync(path.join(top, "wt-local", "feature.txt"), "utf8")).toBe("stale\n");
    const missing = await createWorktree(clone, path.join(top, "wt-missing"), "capsule/four", { baseRef: ref("no-such-branch") });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("no-such-branch");
  });

  it("lists the default and recent branches without fetching", async () => {
    const { clone } = fixture();
    const bases = await listWorktreeBases(clone);
    expect(bases.defaultRef).toBe("origin/main");
    expect(bases.remote).toBe("origin");
    expect(bases.currentBranch).toBe("stale-feature");
    expect(bases.choices.map((choice) => choice.ref)).toEqual(expect.arrayContaining(["main", "stale-feature", "origin/main"]));
    expect(bases.choices.some((choice) => choice.ref === "origin/HEAD")).toBe(false);
  });

  it("moves an unused worktree to a new base, and refuses once it has work", async () => {
    const { top, clone, upstreamTip } = fixture();
    const worktree = path.join(top, "wt-move");
    await createWorktree(clone, worktree, "capsule/five", { baseRef: ref("stale-feature") });
    const moved = await rebaseFreshWorktree(clone, worktree, "capsule/five", ref("origin/main"));
    expect(moved).toMatchObject({ ok: true, baseRef: "origin/main" });
    expect(git(worktree, "rev-parse", "HEAD")).toBe(upstreamTip);
    fs.writeFileSync(path.join(worktree, "draft.txt"), "mine\n");
    expect((await rebaseFreshWorktree(clone, worktree, "capsule/five", ref("stale-feature"))).ok).toBe(false);
    git(worktree, "add", "draft.txt");
    git(worktree, "-c", "user.email=f@example.test", "-c", "user.name=F", "commit", "-qm", "mine");
    const refused = await rebaseFreshWorktree(clone, worktree, "capsule/five", ref("stale-feature"));
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain("own commits");
  });

  it("builds fetch commands as plain arguments", () => {
    expect(fetchBranchArgs("origin", "feature/x")).toEqual(["fetch", "--no-tags", "origin", "+refs/heads/feature/x:refs/remotes/origin/feature/x"]);
    expect(fetchPullRequestArgs("origin", 12)).toEqual(["fetch", "--no-tags", "origin", "+refs/pull/12/head:refs/capsule/pull/12"]);
    expect(() => fetchPullRequestArgs("origin", -1)).toThrow();
    expect(() => fetchPullRequestArgs("origin", Number.NaN)).toThrow();
    expect(splitRemoteRef("upstream/team/main", ["origin", "upstream/team"])).toEqual({ remote: "upstream/team", branch: "main" });
    expect(splitRemoteRef("main", ["origin"])).toBeUndefined();
  });
});

describe("pull request checkout", { timeout: 30_000 }, () => {
  function withPullRequest() {
    const repo = fixture();
    git(repo.seed, "switch", "-q", "-c", "fork-work");
    const head = commit(repo.seed, "pr.txt", "from the pull request\n");
    git(repo.seed, "push", "-q", "origin", "HEAD:refs/pull/1/head");
    return { ...repo, head };
  }

  it("fetches refs/pull/<n>/head and branches a worktree from it", async () => {
    const { top, clone, head } = withPullRequest();
    const fetched = await fetchPullRequest(clone, 1, ref("fork-work"));
    expect(fetched).toMatchObject({ ok: true, commit: head });
    if (!fetched.ok) return;
    // A fork's branch is not on origin, so there is nothing to track.
    expect(fetched.upstream).toBeUndefined();
    const created = await createWorktree(clone, path.join(top, "wt-pr"), "capsule/pr-1", { baseRef: fetched.ref });
    expect(created.ok).toBe(true);
    expect(fs.readFileSync(path.join(top, "wt-pr", "pr.txt"), "utf8")).toBe("from the pull request\n");
  });

  it("tracks the head branch when it lives on origin at the same commit", async () => {
    const { seed, clone, head } = withPullRequest();
    git(seed, "push", "-q", "origin", "fork-work");
    const fetched = await fetchPullRequest(clone, 1, ref("fork-work"));
    expect(fetched).toMatchObject({ ok: true, commit: head, upstream: "origin/fork-work" });
  });

  it("says plainly when the pull request does not exist", async () => {
    const { clone } = withPullRequest();
    const fetched = await fetchPullRequest(clone, 99);
    expect(fetched.ok).toBe(false);
    if (!fetched.ok) expect(fetched.detail).toContain("#99");
    expect(pullRequestFetchFailure(3, "fatal: Authentication failed for 'https://token@example.test/x'")).not.toContain("token");
  });

  it("refuses a local checkout over uncommitted work, then checks out when clean", async () => {
    const { clone, head } = withPullRequest();
    const fetched = await fetchPullRequest(clone, 1);
    if (!fetched.ok) throw new Error(fetched.detail);
    fs.writeFileSync(path.join(clone, "feature.txt"), "unsaved\n");
    const refused = await checkoutPullRequestLocally(clone, fetched, "capsule/pr-1");
    expect(refused.ok).toBe(false);
    expect(fs.readFileSync(path.join(clone, "feature.txt"), "utf8")).toBe("unsaved\n");
    git(clone, "checkout", "--", "feature.txt");
    const done = await checkoutPullRequestLocally(clone, fetched, "capsule/pr-1");
    expect(done.ok).toBe(true);
    expect(git(clone, "branch", "--show-current")).toBe("capsule/pr-1");
    expect(git(clone, "rev-parse", "HEAD")).toBe(head);
  });
});

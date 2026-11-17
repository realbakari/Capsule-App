import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutBranch, COMMIT_TIMEOUT, commitChanges, readGitStatus } from "./git.js";
import { clearFetchState, commitsSince, fetchRemote, hookFailure, parseTracking, pullCurrentBranch, pushCurrentBranch, REMOTE_TIMEOUT } from "./git-sync.js";

const roots: string[] = [];
afterEach(() => {
  clearFetchState();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-sync-"));
  roots.push(root);
  return root;
}

function identity(cwd: string) {
  git(cwd, "config", "user.name", "Capsule Test");
  git(cwd, "config", "user.email", "fixture@example.test");
}

function repository() {
  const root = folder();
  git(root, "init", "-b", "main");
  identity(root);
  writeFileSync(path.join(root, "a.txt"), "a\n");
  writeFileSync(path.join(root, "b.txt"), "b\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

/** A work tree and a second clone sharing a bare remote named `backup`, not `origin`. */
function withRemote() {
  const bare = path.join(folder(), "remote.git");
  spawnSync("git", ["init", "--bare", "-b", "main", bare]);
  const work = repository();
  git(work, "remote", "add", "backup", bare);
  git(work, "push", "-u", "backup", "main");
  git(work, "remote", "set-head", "backup", "main");
  const other = path.join(folder(), "other");
  git(path.dirname(other), "clone", "-o", "backup", bare, other);
  identity(other);
  return { bare, work, other };
}

function hook(root: string, name: string, script: string) {
  const file = path.join(root, ".git", "hooks", name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
}

const committedFiles = (root: string) => git(root, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
const stagedFiles = (root: string) => git(root, "diff", "--cached", "--name-only").split("\n").filter(Boolean).sort();

describe("commit", () => {
  it("commits only what is staged, leaving unstaged edits alone", async () => {
    const root = repository();
    writeFileSync(path.join(root, "a.txt"), "a2\n");
    writeFileSync(path.join(root, "b.txt"), "b2\n");
    git(root, "add", "a.txt");
    const result = await commitChanges(root, "Stage a", { staged: true });
    expect(result.ok, result.detail).toBe(true);
    expect(committedFiles(root)).toEqual(["a.txt"]);
    expect(git(root, "status", "--porcelain")).toBe("M b.txt");
  });

  it("refuses a staged commit with nothing staged instead of adding everything", async () => {
    const root = repository();
    writeFileSync(path.join(root, "a.txt"), "a2\n");
    const result = await commitChanges(root, "Nothing", { staged: true });
    expect(result).toEqual({ ok: false, detail: "Nothing is staged. Choose the files to commit." });
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("commits chosen paths, untracked included, and keeps other staged work out", async () => {
    const root = repository();
    writeFileSync(path.join(root, "a.txt"), "a2\n");
    writeFileSync(path.join(root, "b.txt"), "b2\n");
    writeFileSync(path.join(root, "new file.txt"), "new\n");
    git(root, "add", "a.txt");
    const result = await commitChanges(root, "Subject line\n\nBody line", { paths: ["b.txt", "new file.txt"] });
    expect(result.ok, result.detail).toBe(true);
    expect(committedFiles(root)).toEqual(["b.txt", "new file.txt"]);
    expect(stagedFiles(root)).toEqual(["a.txt"]);
    expect(git(root, "log", "-1", "--format=%s|%b")).toBe("Subject line|Body line");
  });

  it("surfaces a hook's output and leaves the index as it was", async () => {
    const root = repository();
    hook(root, "pre-commit", "echo 'lint: b.txt has a problem' >&2; exit 1");
    writeFileSync(path.join(root, "b.txt"), "b2\n");
    const result = await commitChanges(root, "Blocked", { paths: ["b.txt"] });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("A commit hook stopped the commit");
    expect(result.detail).toContain("lint: b.txt has a problem");
    expect(stagedFiles(root)).toEqual([]);
    expect((await readGitStatus(root)).hooks).toEqual(["pre-commit"]);
  });

  it("keeps a hook's own fix in the index after a chosen-paths commit", async () => {
    const root = repository();
    hook(root, "pre-commit", "echo fixed > b.txt; git add b.txt");
    writeFileSync(path.join(root, "b.txt"), "b2\n");
    const result = await commitChanges(root, "Formatted", { paths: ["b.txt"] });
    expect(result.ok, result.detail).toBe(true);
    expect(git(root, "show", "HEAD:b.txt")).toBe("fixed");
    expect(stagedFiles(root)).toEqual([]);
  });

  it("waits minutes for hooks by default, and the limit is configurable", async () => {
    expect(COMMIT_TIMEOUT).toBe(600_000);
    expect(REMOTE_TIMEOUT).toBe(600_000);
    const root = repository();
    hook(root, "pre-commit", "sleep 2");
    writeFileSync(path.join(root, "b.txt"), "b2\n");
    const result = await commitChanges(root, "Slow", { paths: ["b.txt"] }, { timeout: 300 });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/took longer than 1 second/);
  }, 15_000);
});

it("quotes a hook without terminal colour or remote credentials, and leaves Git's own refusals alone", () => {
  const quoted = hookFailure(`\u001b[31mtests failed\u001b[0m\nerror: failed to push some refs to 'https://user:fixture-secret@host.test/repo'`, "pre-push", "push");
  expect(quoted).toBe("The pre-push hook stopped the push. Its output:\ntests failed");
  expect(hookFailure("! [rejected] main -> main (fetch first)", "pre-push", "push")).toBeUndefined();
  expect(hookFailure("anything", undefined, "commit")).toBeUndefined();
});

describe("tracking", () => {
  it("reads upstream, push remote, default branch and remote branches without a hardcoded origin", async () => {
    const { work, other } = withRemote();
    git(other, "checkout", "-b", "shared");
    writeFileSync(path.join(other, "c.txt"), "c\n");
    git(other, "add", "c.txt");
    git(other, "commit", "-m", "Shared work");
    git(other, "push", "backup", "shared");
    git(work, "fetch", "backup");
    const status = await readGitStatus(work);
    expect(status).toMatchObject({ branch: "main", upstream: "backup/main", pushRemote: "backup", defaultBranch: "main", ahead: 0, behind: 0 });
    expect(status.remoteBranches).toEqual(["backup/shared"]);
  });

  it("chooses the push remote from config before falling back", () => {
    const rows = (pushRemote: string) => `refs/heads/feature\0\0\0${pushRemote}\0/work\0\n`;
    expect(parseTracking(rows(""), ["origin", "fork"], "feature", "/work").pushRemote).toBe("origin");
    expect(parseTracking(rows(""), ["fork"], "feature", "/work").pushRemote).toBe("fork");
    expect(parseTracking(rows("fork"), ["origin", "fork"], "feature", "/work").pushRemote).toBe("fork");
    expect(parseTracking(rows(""), ["one", "two"], "feature", "/work").pushRemote).toBeUndefined();
  });

  it("treats a differently named upstream as a base, not as where the branch publishes", () => {
    const row = "refs/heads/feature\0refs/remotes/origin/main\0origin\0origin\0/work\0\n";
    expect(parseTracking(row, ["origin"], "feature", "/work").upstream).toBeUndefined();
  });
});

describe("push", () => {
  it("publishes a never-pushed branch to the configured remote and sets its upstream", async () => {
    const { work, bare } = withRemote();
    git(work, "checkout", "-b", "feature");
    writeFileSync(path.join(work, "b.txt"), "b2\n");
    git(work, "commit", "-am", "Feature");
    expect((await readGitStatus(work)).upstream).toBeUndefined();
    const result = await pushCurrentBranch(work, { forceWithLease: false });
    expect(result).toEqual({ ok: true, detail: "Published feature to backup." });
    expect(git(bare, "rev-parse", "feature")).toBe(git(work, "rev-parse", "HEAD"));
    expect(await readGitStatus(work)).toMatchObject({ upstream: "backup/feature", ahead: 0, behind: 0 });
  });

  it("says Pull when the remote moved on", async () => {
    const { work, other } = withRemote();
    writeFileSync(path.join(other, "c.txt"), "c\n");
    git(other, "add", "c.txt");
    git(other, "commit", "-m", "Theirs");
    git(other, "push");
    git(work, "commit", "--allow-empty", "-m", "Ours");
    const result = await pushCurrentBranch(work, { forceWithLease: false });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("The remote branch has changed. Pull its changes, then push again.");
  });
});

describe("pull and fetch", () => {
  it("fetches quietly, at most once per window, so behind is fresh", async () => {
    const { work, other } = withRemote();
    git(other, "commit", "--allow-empty", "-m", "Theirs");
    git(other, "push");
    expect((await readGitStatus(work)).behind).toBe(0);
    expect(await fetchRemote(work, { now: 1_000 })).toBe(true);
    expect((await readGitStatus(work)).behind).toBe(1);
    expect(existsSync(path.join(work, ".git", "FETCH_HEAD"))).toBe(false);
    expect(await fetchRemote(work, { now: 2_000 })).toBe(false);
    expect(await fetchRemote(work, { now: 2_000, force: true })).toBe(true);
  });

  it("is quiet when the remote cannot be reached", async () => {
    const { work } = withRemote();
    git(work, "remote", "set-url", "backup", path.join(folder(), "missing.git"));
    expect(await fetchRemote(work)).toBe(false);
  });

  it("fast-forwards only, by default", async () => {
    const { work, other } = withRemote();
    git(other, "commit", "--allow-empty", "-m", "Theirs");
    git(other, "push");
    const result = await pullCurrentBranch(work, "ff-only");
    expect(result).toEqual({ ok: true, detail: "Pulled from backup/main." });
    expect(await readGitStatus(work)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("detects a diverged branch, then rebases on request", async () => {
    const { work, other } = withRemote();
    writeFileSync(path.join(other, "c.txt"), "c\n");
    git(other, "add", "c.txt");
    git(other, "commit", "-m", "Theirs");
    git(other, "push");
    writeFileSync(path.join(work, "d.txt"), "d\n");
    git(work, "add", "d.txt");
    git(work, "commit", "-m", "Ours");
    await fetchRemote(work);
    expect(await readGitStatus(work)).toMatchObject({ ahead: 1, behind: 1 });
    const refused = await pullCurrentBranch(work, "ff-only");
    expect(refused).toMatchObject({ ok: false, diverged: true });
    expect(git(work, "log", "-1", "--format=%s")).toBe("Ours");
    expect(await pullCurrentBranch(work, "rebase")).toEqual({ ok: true, detail: "Rebased onto backup/main." });
    expect(await readGitStatus(work)).toMatchObject({ ahead: 1, behind: 0 });
  });

  it("abandons a conflicting rebase rather than leave it half done", async () => {
    const { work, other } = withRemote();
    writeFileSync(path.join(other, "a.txt"), "theirs\n");
    git(other, "commit", "-am", "Theirs");
    git(other, "push");
    writeFileSync(path.join(work, "a.txt"), "ours\n");
    git(work, "commit", "-am", "Ours");
    const before = git(work, "rev-parse", "HEAD");
    const result = await pullCurrentBranch(work, "rebase");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("stopped on a conflict, so nothing changed");
    expect(git(work, "rev-parse", "HEAD")).toBe(before);
    expect(existsSync(path.join(work, ".git", "rebase-merge"))).toBe(false);
  });
});

describe("branches", () => {
  it("checks out a remote branch as a local branch that tracks it", async () => {
    const { work, other } = withRemote();
    git(other, "checkout", "-b", "shared");
    git(other, "commit", "--allow-empty", "-m", "Shared");
    git(other, "push", "backup", "shared");
    git(work, "fetch", "backup");
    const result = await checkoutBranch(work, "backup/shared");
    expect(result).toEqual({ ok: true, detail: "Checked out shared." });
    expect(await readGitStatus(work)).toMatchObject({ branch: "shared", upstream: "backup/shared" });
  });

  it("names the worktree that already has a branch checked out", async () => {
    const root = repository();
    const elsewhere = path.join(folder(), "wt");
    git(root, "worktree", "add", "-b", "busy", elsewhere);
    const status = await readGitStatus(root);
    expect(Object.keys(status.checkedOutElsewhere ?? {})).toEqual(["busy"]);
    const result = await checkoutBranch(root, "busy");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/^busy is checked out in another worktree, at .*wt\. Open that folder/);
  });

  it("lists the commits a branch adds, oldest first", async () => {
    const root = repository();
    git(root, "checkout", "-b", "feature");
    git(root, "commit", "--allow-empty", "-m", "First", "-m", "Why first");
    git(root, "commit", "--allow-empty", "-m", "Second");
    expect(await commitsSince(root, "main")).toEqual([{ subject: "First", body: "Why first" }, { subject: "Second", body: "" }]);
  });
});

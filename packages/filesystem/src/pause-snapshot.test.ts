import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { threadSnapshotRef } from "./checkpoints.js";
import { restorePausedWorktree, savePausedWorktree } from "./pause-snapshot.js";
import { createWorktree } from "./worktrees.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

/** A repository with a thread worktree holding every kind of change. */
async function pausedFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-pause-"));
  roots.push(base);
  const root = path.join(base, "repo");
  fs.mkdirSync(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "capsule@example.test");
  git(root, "config", "user.name", "Capsule Test");
  fs.writeFileSync(path.join(root, "kept.txt"), "kept\n");
  fs.writeFileSync(path.join(root, "staged.txt"), "staged before\n");
  fs.writeFileSync(path.join(root, "removed.txt"), "removed\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored.log\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  const worktree = path.join(base, "thread");
  expect((await createWorktree(root, worktree, "capsule/paused-thread")).ok).toBe(true);
  fs.writeFileSync(path.join(worktree, "staged.txt"), "staged after\n");
  git(worktree, "add", "staged.txt");
  fs.writeFileSync(path.join(worktree, "staged.txt"), "staged after, then edited\n");
  fs.writeFileSync(path.join(worktree, "kept.txt"), "kept, edited\n");
  fs.rmSync(path.join(worktree, "removed.txt"));
  fs.mkdirSync(path.join(worktree, "new"));
  fs.writeFileSync(path.join(worktree, "new", "untracked.txt"), "untracked\n");
  fs.writeFileSync(path.join(worktree, "ignored.log"), "ignored\n");
  const ref = threadSnapshotRef("thread-1", "paused");
  return { root, worktree, ref };
}

function state(worktree: string) {
  const read = (name: string) => fs.existsSync(path.join(worktree, name)) ? fs.readFileSync(path.join(worktree, name), "utf8") : null;
  return {
    status: git(worktree, "status", "--porcelain=v1", "--untracked-files=all"),
    staged: git(worktree, "diff", "--cached"),
    unstaged: git(worktree, "diff"),
    head: git(worktree, "rev-parse", "HEAD"),
    files: ["kept.txt", "staged.txt", "removed.txt", "new/untracked.txt"].map(read),
  };
}

describe("pausing a worktree thread", () => {
  it("leaves the branch, files and staging area alone", async () => {
    const { worktree, ref } = await pausedFixture();
    const before = state(worktree);
    const branches = git(worktree, "branch", "--list");
    const saved = await savePausedWorktree(worktree, ref);
    expect(saved.ok).toBe(true);
    expect(state(worktree)).toEqual(before);
    expect(git(worktree, "branch", "--list")).toBe(branches);
    expect(git(worktree, "rev-parse", "--verify", ref).trim()).toBeTruthy();
  });

  it("restores the exact working tree when the paused work was wiped", async () => {
    const { worktree, ref } = await pausedFixture();
    const before = state(worktree);
    expect((await savePausedWorktree(worktree, ref)).ok).toBe(true);
    git(worktree, "reset", "-q", "--hard");
    git(worktree, "clean", "-qfd");
    expect(state(worktree)).not.toEqual(before);

    const resumed = await restorePausedWorktree(worktree, ref);
    expect(resumed).toMatchObject({ ok: true, outcome: "restored" });
    expect(state(worktree)).toEqual(before);
    expect(fs.readFileSync(path.join(worktree, "ignored.log"), "utf8")).toBe("ignored\n");
    expect(() => git(worktree, "rev-parse", "--verify", "--quiet", ref)).toThrow();
  });

  it("brings back a worktree folder removed while paused", async () => {
    const { root, worktree, ref } = await pausedFixture();
    const before = state(worktree);
    expect((await savePausedWorktree(worktree, ref)).ok).toBe(true);
    git(root, "worktree", "remove", "--force", worktree);

    const resumed = await restorePausedWorktree(worktree, ref, { repository: root, branch: "capsule/paused-thread" });
    expect(resumed).toMatchObject({ ok: true, outcome: "restored" });
    expect(state(worktree)).toEqual(before);
  });

  it("does nothing to a folder that still matches", async () => {
    const { worktree, ref } = await pausedFixture();
    const before = state(worktree);
    expect((await savePausedWorktree(worktree, ref)).ok).toBe(true);
    expect(await restorePausedWorktree(worktree, ref)).toMatchObject({ ok: true, outcome: "unchanged" });
    expect(state(worktree)).toEqual(before);
  });

  it("never overwrites work done while paused, and keeps the snapshot", async () => {
    const { worktree, ref } = await pausedFixture();
    expect((await savePausedWorktree(worktree, ref)).ok).toBe(true);
    fs.writeFileSync(path.join(worktree, "kept.txt"), "edited while paused\n");
    const resumed = await restorePausedWorktree(worktree, ref);
    expect(resumed).toMatchObject({ ok: true, outcome: "kept" });
    expect(fs.readFileSync(path.join(worktree, "kept.txt"), "utf8")).toBe("edited while paused\n");
    expect(git(worktree, "rev-parse", "--verify", ref).trim()).toBeTruthy();
  });
});

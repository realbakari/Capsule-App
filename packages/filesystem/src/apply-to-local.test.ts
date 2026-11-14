import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyUndoRef,
  applyWorktreeChanges,
  latestApplyRecord,
  readWorktreeChangeCount,
  undoWorktreeApply,
} from "./apply-to-local.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A project checkout with a linked worktree on its own branch. */
function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "capsule-apply-")));
  roots.push(root);
  const checkout = path.join(root, "project");
  const worktree = path.join(root, "thread");
  fs.mkdirSync(checkout);
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "config", "user.email", "capsule@example.test");
  git(checkout, "config", "user.name", "Capsule Test");
  fs.writeFileSync(path.join(checkout, "readme.md"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(checkout, "obsolete.txt"), "remove me\n");
  fs.writeFileSync(path.join(checkout, "old-name.txt"), Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n");
  fs.writeFileSync(path.join(checkout, "shared.txt"), "base\n");
  git(checkout, "add", "-A");
  git(checkout, "commit", "-qm", "initial");
  git(checkout, "worktree", "add", "-q", "-b", "capsule/thread", worktree);
  const read = (relative: string) => fs.readFileSync(path.join(checkout, relative), "utf8");
  const write = (folder: string, relative: string, content: string | Buffer) => fs.writeFileSync(path.join(folder, relative), content);
  return { checkout, worktree, read, write };
}

const BINARY = Buffer.from([0, 1, 2, 3, 255, 254, 0, 7]);

describe("applying a worktree to the project checkout", { timeout: 30_000 }, () => {
  it("lands committed, uncommitted, untracked, binary, deleted and renamed changes as unstaged edits", async () => {
    const { checkout, worktree, read, write } = repository();
    write(worktree, "readme.md", "one\nTWO\nthree\n");
    git(worktree, "commit", "-qam", "committed on the branch");
    write(worktree, "shared.txt", "edited, not committed\n");
    write(worktree, "notes.txt", "untracked\n");
    write(worktree, "image.bin", BINARY);
    fs.rmSync(path.join(worktree, "obsolete.txt"));
    git(worktree, "mv", "old-name.txt", "new-name.txt");
    const indexBefore = git(checkout, "write-tree");

    expect(await readWorktreeChangeCount(worktree, checkout)).toBe(6);
    const result = await applyWorktreeChanges({ worktree, checkout, undoRef: applyUndoRef("s1", 1), branch: "capsule/thread" });

    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect([...result.files].sort()).toEqual(["image.bin", "new-name.txt", "notes.txt", "readme.md", "shared.txt"].concat("obsolete.txt").sort());
    expect(read("readme.md")).toBe("one\nTWO\nthree\n");
    expect(read("shared.txt")).toBe("edited, not committed\n");
    expect(read("notes.txt")).toBe("untracked\n");
    expect(fs.readFileSync(path.join(checkout, "image.bin"))).toEqual(BINARY);
    expect(fs.existsSync(path.join(checkout, "obsolete.txt"))).toBe(false);
    expect(fs.existsSync(path.join(checkout, "old-name.txt"))).toBe(false);
    expect(read("new-name.txt")).toContain("line 39");
    expect(git(checkout, "write-tree")).toBe(indexBefore);
    expect(git(checkout, "diff", "--cached", "--name-only")).toBe("");
    expect(git(checkout, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(git(worktree, "status", "--porcelain")).toContain("notes.txt");
  });

  it("leaves conflict markers and lists the conflicted files", async () => {
    const { checkout, worktree, read, write } = repository();
    write(worktree, "shared.txt", "theirs\n");
    write(worktree, "readme.md", "one\ntwo\nthree\nfour\n");
    write(checkout, "shared.txt", "ours\n");

    const result = await applyWorktreeChanges({ worktree, checkout, undoRef: applyUndoRef("s1", 2) });

    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual(["shared.txt"]);
    expect(read("shared.txt")).toMatch(/<<<<<<< [^\n]*\nours\n=======\ntheirs\n>>>>>>> /);
    expect(read("readme.md")).toBe("one\ntwo\nthree\nfour\n");
    expect(git(checkout, "ls-files", "-u")).toBe("");
    expect(result.undoRef).toBe(applyUndoRef("s1", 2));
  });

  it("undo restores the checkout exactly, removing files the apply created", async () => {
    const { checkout, worktree, write } = repository();
    write(worktree, "shared.txt", "theirs\n");
    write(worktree, "created.txt", "new\n");
    write(worktree, "image.bin", BINARY);
    fs.rmSync(path.join(worktree, "obsolete.txt"));
    git(worktree, "mv", "old-name.txt", "renamed.txt");
    write(checkout, "shared.txt", "ours, uncommitted\n");
    write(checkout, "mine.txt", "the user's own untracked file\n");
    const snapshot = () => git(checkout, "status", "--porcelain", "-uall") + git(checkout, "diff") + fs.readFileSync(path.join(checkout, "mine.txt"), "utf8");
    const before = snapshot();

    const result = await applyWorktreeChanges({ worktree, checkout, undoRef: applyUndoRef("s1", 3) });
    expect(result.conflicts).toEqual(["shared.txt"]);
    expect((await latestApplyRecord(checkout, "s1"))?.files.length).toBe(5);

    const undone = await undoWorktreeApply(checkout, result.undoRef!);
    expect(undone.ok).toBe(true);
    expect(snapshot()).toBe(before);
    expect(fs.existsSync(path.join(checkout, "created.txt"))).toBe(false);
    expect(fs.existsSync(path.join(checkout, "renamed.txt"))).toBe(false);
    expect(fs.existsSync(path.join(checkout, "image.bin"))).toBe(false);
    expect(await latestApplyRecord(checkout, "s1")).toBeUndefined();
    expect((await undoWorktreeApply(checkout, result.undoRef!)).ok).toBe(false);
  });

  it("refuses while the checkout is in the middle of a merge", async () => {
    const { checkout, worktree, read, write } = repository();
    git(checkout, "checkout", "-q", "-b", "side");
    write(checkout, "shared.txt", "side\n");
    git(checkout, "commit", "-qam", "side");
    git(checkout, "checkout", "-q", "main");
    write(checkout, "shared.txt", "main\n");
    git(checkout, "commit", "-qam", "main");
    expect(() => git(checkout, "merge", "side")).toThrow();
    write(worktree, "readme.md", "changed\n");

    const result = await applyWorktreeChanges({ worktree, checkout, undoRef: applyUndoRef("s1", 4) });

    expect(result.applied).toBe(false);
    expect(result.detail).toMatch(/merge in progress/);
    expect(read("readme.md")).toBe("one\ntwo\nthree\n");
    expect(await latestApplyRecord(checkout, "s1")).toBeUndefined();
  });

  it("reports nothing to apply for an untouched worktree", async () => {
    const { checkout, worktree } = repository();
    expect(await readWorktreeChangeCount(worktree, checkout)).toBe(0);
    const result = await applyWorktreeChanges({ worktree, checkout, undoRef: applyUndoRef("s1", 5) });
    expect(result).toMatchObject({ applied: false, files: [], detail: "The worktree has no changes to apply." });
  });
});

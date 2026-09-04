import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureCheckpoint,
  checkpointNumstat,
  checkpointRef,
  deleteCheckpoints,
  diffCheckpoints,
  hasCheckpoint,
  restoreCheckpoint,
} from "./checkpoints.js";

const made: string[] = [];

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

/** A real repository — these functions are git plumbing, so mocks prove nothing. */
function repo(withCommit = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-ckpt-"));
  made.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  if (withCommit) {
    fs.writeFileSync(path.join(dir, "kept.txt"), "one\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "init"]);
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("checkpointRef", () => {
  it("keeps a crafted id inside the checkpoint namespace", () => {
    expect(checkpointRef("../../heads/main", 1)).toBe(
      "refs/capsule/checkpoints/heads-main/turn/1",
    );
    expect(checkpointRef("a b/c", 2)).toBe("refs/capsule/checkpoints/a-b-c/turn/2");
    expect(checkpointRef("ok", -5)).toBe("refs/capsule/checkpoints/ok/turn/0");
  });
});

describe("captureCheckpoint", () => {
  it("captures the worktree without disturbing the user's index", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "staged.txt"), "s\n");
    git(dir, ["add", "staged.txt"]);
    fs.writeFileSync(path.join(dir, "loose.txt"), "l\n");
    const stagedBefore = git(dir, ["diff", "--cached", "--name-only"]).stdout;

    const ref = checkpointRef("s1", 1);
    expect((await captureCheckpoint(dir, ref)).ok).toBe(true);

    // The index is exactly as the user left it.
    expect(git(dir, ["diff", "--cached", "--name-only"]).stdout).toBe(stagedBefore);
    // Both the staged and the unstaged file are in the checkpoint.
    expect(git(dir, ["cat-file", "-e", `${ref}:staged.txt`]).status).toBe(0);
    expect(git(dir, ["cat-file", "-e", `${ref}:loose.txt`]).status).toBe(0);
  });

  it("leaves no branch, tag or log entry behind", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    await captureCheckpoint(dir, checkpointRef("s1", 1));

    expect(git(dir, ["branch", "--list"]).stdout).not.toContain("capsule");
    expect(git(dir, ["tag", "--list"]).stdout.trim()).toBe("");
    expect(git(dir, ["log", "--oneline"]).stdout).not.toContain("checkpoint");
  });

  it("cleans up its temporary index", async () => {
    const dir = repo();
    await captureCheckpoint(dir, checkpointRef("s1", 1));
    const leftovers = fs
      .readdirSync(path.join(dir, ".git"))
      .filter((name) => name.startsWith("capsule-checkpoint-index-"));
    expect(leftovers).toEqual([]);
  });

  it("works before the first commit", async () => {
    const dir = repo(false);
    fs.writeFileSync(path.join(dir, "first.txt"), "1\n");
    const ref = checkpointRef("s1", 1);
    expect((await captureCheckpoint(dir, ref)).ok).toBe(true);
    expect(await hasCheckpoint(dir, ref)).toBe(true);
  });

  it("reports rather than throws outside a repository", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-plain-"));
    made.push(dir);
    const result = await captureCheckpoint(dir, checkpointRef("s1", 1));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Not a Git repository");
  });
});

describe("diff between checkpoints", () => {
  it("scopes to one turn, excluding earlier changes", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "turn1.txt"), "one\n");
    const first = checkpointRef("s1", 1);
    await captureCheckpoint(dir, first);

    fs.writeFileSync(path.join(dir, "turn2.txt"), "two\n");
    const second = checkpointRef("s1", 2);
    await captureCheckpoint(dir, second);

    const scoped = (await checkpointNumstat(dir, second, first)).map((entry) => entry.path);
    expect(scoped).toEqual(["turn2.txt"]);

    const patch = await diffCheckpoints(dir, second, first);
    expect(patch).toContain("turn2.txt");
    expect(patch).not.toContain("turn1.txt");
  });

  it("counts a binary file as zero rather than NaN", async () => {
    const dir = repo();
    const first = checkpointRef("s1", 1);
    await captureCheckpoint(dir, first);
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 3]));
    const second = checkpointRef("s1", 2);
    await captureCheckpoint(dir, second);

    const entry = (await checkpointNumstat(dir, second, first)).find((row) => row.path === "blob.bin");
    expect(entry).toBeDefined();
    expect(Number.isNaN(entry!.added)).toBe(false);
    expect(entry!.added).toBe(0);
  });

  it("returns empty for a checkpoint that does not exist", async () => {
    const dir = repo();
    expect(await diffCheckpoints(dir, checkpointRef("nope", 9))).toBe("");
    expect(await checkpointNumstat(dir, checkpointRef("nope", 9))).toEqual([]);
  });
});

describe("restoreCheckpoint", () => {
  it("puts back an edited file and removes one created afterwards", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "kept.txt"), "original\n");
    const ref = checkpointRef("s1", 1);
    await captureCheckpoint(dir, ref);

    fs.writeFileSync(path.join(dir, "kept.txt"), "changed by the agent\n");
    fs.writeFileSync(path.join(dir, "added-later.txt"), "new\n");

    expect((await restoreCheckpoint(dir, ref)).ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "kept.txt"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(dir, "added-later.txt"))).toBe(false);
  });

  it("refuses a missing checkpoint instead of emptying the worktree", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "kept.txt"), "still here\n");
    const result = await restoreCheckpoint(dir, checkpointRef("gone", 4));
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(dir, "kept.txt"), "utf8")).toBe("still here\n");
  });
});

describe("deleteCheckpoints", () => {
  it("removes only the named session's refs", async () => {
    const dir = repo();
    await captureCheckpoint(dir, checkpointRef("keep", 1));
    await captureCheckpoint(dir, checkpointRef("drop", 1));
    await captureCheckpoint(dir, checkpointRef("drop", 2));

    expect(await deleteCheckpoints(dir, "drop")).toBe(2);
    expect(await hasCheckpoint(dir, checkpointRef("drop", 1))).toBe(false);
    expect(await hasCheckpoint(dir, checkpointRef("keep", 1))).toBe(true);
  });
});

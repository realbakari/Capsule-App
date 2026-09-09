import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@capsule/shared";
import { previewCheckpoint, CHECKPOINT_PATCH_BYTES } from "./checkpoint-preview.js";
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
  // These integration scenarios create two real snapshots and issue many Git
  // reads (one also writes 18 MB). Their total runtime is not a unit benchmark;
  // keep a bounded budget without racing five seconds on a loaded CI runner.
  it.each(["diff.noprefix", "diff.mnemonicPrefix"])("keeps metadata-only file identities when %s is enabled", { timeout: 20_000 }, async (setting) => {
    const dir = repo();
    git(dir, ["config", setting, "true"]);
    git(dir, ["config", "core.filemode", "true"]);
    const from = checkpointRef("prefixes", 1);
    const to = checkpointRef("prefixes", 2);
    fs.writeFileSync(path.join(dir, "removed empty.txt"), "");
    await captureCheckpoint(dir, from);
    fs.unlinkSync(path.join(dir, "removed empty.txt"));
    fs.writeFileSync(path.join(dir, "new empty.txt"), "");
    fs.writeFileSync(path.join(dir, "binary.dat"), Buffer.from([0, 1, 2, 0]));
    fs.chmodSync(path.join(dir, "kept.txt"), 0o755);
    await captureCheckpoint(dir, to);
    const expected = ["binary.dat", "kept.txt", "new empty.txt", "removed empty.txt"];
    const summary = await previewCheckpoint(dir, to, from, { summaryOnly: true });
    expect(summary.files.map((file) => file.path)).toEqual(expected);
    const all = await previewCheckpoint(dir, to, from);
    expect(parseUnifiedDiff(all.patch).map((file) => file.path)).toEqual(expected);
    const legacy = parseUnifiedDiff(await diffCheckpoints(dir, to, from));
    expect(legacy.map((file) => file.path)).toEqual(["binary.dat", "kept.txt", "new empty.txt"]);
    expect(legacy.find((file) => file.path === "new empty.txt")?.oldPath).toBe("removed empty.txt");
    for (const relative of expected) {
      const preview = await previewCheckpoint(dir, to, from, { relative });
      expect(parseUnifiedDiff(preview.patch)).toHaveLength(1);
      expect(parseUnifiedDiff(preview.patch)[0]?.path).toBe(relative);
    }
    expect(git(dir, ["config", "--get", setting]).stdout.trim()).toBe("true");
  });

  it("keeps large saved changes readable with bounded, lazy file previews", { timeout: 20_000 }, async () => {
    const dir = repo();
    const from = checkpointRef("large", 1);
    const to = checkpointRef("large", 2);
    await captureCheckpoint(dir, from);
    // Larger than the old 16 MB exec buffer; the list must not need this patch.
    fs.writeFileSync(path.join(dir, "a-large.txt"), "a line of generated text\n".repeat(750_000));
    fs.writeFileSync(path.join(dir, "z [literal].ts"), "export const answer = 42;\n");
    await captureCheckpoint(dir, to);
    const summary = await previewCheckpoint(dir, to, from, { summaryOnly: true });
    expect(summary.patch).toBe("");
    expect(summary.files).toContainEqual({ path: "z [literal].ts", added: 1, removed: 0, status: "added" });
    const all = await previewCheckpoint(dir, to, from);
    expect(all.patchTruncated).toBe(true);
    expect(Buffer.byteLength(all.patch)).toBeLessThanOrEqual(CHECKPOINT_PATCH_BYTES);
    expect(all.patch.endsWith("\n")).toBe(true);
    const file = await previewCheckpoint(dir, to, from, { relative: "z [literal].ts" });
    expect(file.patchTruncated).toBe(false);
    expect(file.patch).toContain("export const answer = 42;");
    expect(file.patch).not.toContain("a-large.txt");
    fs.writeFileSync(path.join(dir, "z [literal].ts"), "unrelated later edit\n");
    expect((await previewCheckpoint(dir, to, from, { relative: "z [literal].ts" })).patch).toEqual(file.patch);
    await expect(previewCheckpoint(dir, to, from, { relative: "../outside" })).rejects.toThrow("inside this saved turn");
  });

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

  it("reports missing checkpoints instead of an authoritative empty diff", async () => {
    const dir = repo();
    await expect(diffCheckpoints(dir, checkpointRef("nope", 9))).rejects.toThrow(/checkpoint is unavailable/);
    await expect(checkpointNumstat(dir, checkpointRef("nope", 9))).rejects.toThrow(/checkpoint is unavailable/);
  });

  it("reports a failed Git diff instead of returning a clean turn", async () => {
    const dir = repo();
    const ref = checkpointRef("failed-read", 1);
    await captureCheckpoint(dir, ref);
    fs.writeFileSync(path.join(dir, "kept.txt"), "changed\n");
    git(dir, ["config", "diff.algorithm", "not-an-algorithm"]);
    await expect(diffCheckpoints(dir, ref)).rejects.toThrow(/Could not read the saved diff/);
    await expect(checkpointNumstat(dir, ref)).rejects.toThrow(/Could not read the changed files/);
  });

  it("never substitutes the live worktree for a missing base checkpoint", async () => {
    const dir = repo();
    const ref = checkpointRef("base", 2);
    await captureCheckpoint(dir, ref);
    fs.writeFileSync(path.join(dir, "kept.txt"), "unrelated live edit\n");
    await expect(diffCheckpoints(dir, ref, checkpointRef("base", 1))).rejects.toThrow(/base checkpoint is unavailable/);
    await expect(checkpointNumstat(dir, ref, checkpointRef("base", 1))).rejects.toThrow(/base checkpoint is unavailable/);
  });
});

describe("restoreCheckpoint", () => {
  it("preserves partially staged content, odd filenames and ignored files", async () => {
    const dir = repo();
    const odd = 'tab\tline\nquote".txt';
    fs.writeFileSync(path.join(dir, odd), "checkpoint\n");
    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    const ref = checkpointRef("restore-index", 1);
    expect((await captureCheckpoint(dir, ref)).ok).toBe(true);
    fs.writeFileSync(path.join(dir, "kept.txt"), "staged\n");
    fs.writeFileSync(path.join(dir, "created.txt"), "created later\n");
    git(dir, ["add", "kept.txt", "created.txt"]);
    fs.writeFileSync(path.join(dir, "kept.txt"), "unstaged\n");
    fs.writeFileSync(path.join(dir, "ignored.txt"), "do not change\n");
    fs.unlinkSync(path.join(dir, odd));
    const staged = git(dir, ["diff", "--cached", "--binary"]).stdout;
    expect((await restoreCheckpoint(dir, ref)).ok).toBe(true);
    expect(git(dir, ["diff", "--cached", "--binary"]).stdout).toBe(staged);
    expect(fs.readFileSync(path.join(dir, "kept.txt"), "utf8")).toBe("one\n");
    expect(fs.readFileSync(path.join(dir, odd), "utf8")).toBe("checkpoint\n");
    expect(fs.readFileSync(path.join(dir, "ignored.txt"), "utf8")).toBe("do not change\n");
    expect(fs.existsSync(path.join(dir, "created.txt"))).toBe(false);
  });

  it("restores an empty checkpoint before the first commit", async () => {
    const dir = repo(false);
    const ref = checkpointRef("empty", 1);
    expect((await captureCheckpoint(dir, ref)).ok).toBe(true);
    fs.writeFileSync(path.join(dir, "new.txt"), "later\n");
    expect((await restoreCheckpoint(dir, ref)).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);
  });
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

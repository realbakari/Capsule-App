import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorktree, removeWorktree } from "./worktrees.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("Git worktrees", () => {
  it("creates an isolated branch and removes it only while clean", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-worktree-"));
    git(root, "init");
    git(root, "config", "user.email", "capsule@example.test");
    git(root, "config", "user.name", "Capsule Test");
    fs.writeFileSync(path.join(root, "README.md"), "base\n");
    git(root, "add", "README.md");
    git(root, "commit", "-m", "initial");

    const destination = path.join(root, "..", `${path.basename(root)}-thread`);
    const created = await createWorktree(root, destination, "capsule/thread-one");
    expect(created.ok).toBe(true);
    expect(fs.readFileSync(path.join(destination, "README.md"), "utf8")).toBe("base\n");

    fs.writeFileSync(path.join(destination, "README.md"), "changed\n");
    expect((await removeWorktree(root, destination)).ok).toBe(false);
    expect(fs.existsSync(destination)).toBe(true);

    git(destination, "restore", "README.md");
    expect((await removeWorktree(root, destination)).ok).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
  });
});

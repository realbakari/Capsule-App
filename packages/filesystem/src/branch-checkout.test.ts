import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkoutBranch } from "./git.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(root: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-checkout-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Capsule Test");
  git(root, "config", "user.email", "fixture@example.test");
  writeFileSync(path.join(root, "retired-branch"), "committed\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

it("does not restore a dirty file when a selected branch no longer exists", async () => {
  const root = repository();
  git(root, "branch", "retired-branch");
  git(root, "branch", "-d", "retired-branch");
  const file = path.join(root, "retired-branch");
  writeFileSync(file, "uncommitted work\n");
  expect((await checkoutBranch(root, "retired-branch")).ok).toBe(false);
  expect(readFileSync(file, "utf8")).toBe("uncommitted work\n");
  expect(git(root, "branch", "--show-current")).toBe("main");
});

it("switches to a local branch even when a tracked file has the same name", async () => {
  const root = repository();
  git(root, "branch", "retired-branch");
  expect((await checkoutBranch(root, "retired-branch")).ok).toBe(true);
  expect(git(root, "branch", "--show-current")).toBe("retired-branch");
});

it("retains normal remote-tracking branch discovery", async () => {
  const root = repository();
  git(root, "remote", "add", "origin", "https://example.test/fixture.git");
  git(root, "update-ref", "refs/remotes/origin/remote-feature", "HEAD");
  expect((await checkoutBranch(root, "remote-feature")).ok).toBe(true);
  expect(git(root, "branch", "--show-current")).toBe("remote-feature");
  expect(git(root, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/remote-feature");
});

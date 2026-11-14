import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { issueBranchName } from "@capsule/shared";
import { expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

it("starts a thread from an issue on a worktree branch named after it", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-issue-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe", encoding: "utf8" });
  run("init", "-q");
  run("config", "user.email", "capsule@example.test");
  run("config", "user.name", "Capsule Test");
  writeFileSync(path.join(directory, "README.md"), "initial\n");
  run("add", "README.md");
  run("commit", "-qm", "initial");
  const engine = new CapsuleEngine({ databasePath: ":memory:", userDataDir: directory, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Issues", workingDirectory: directory });
    const branchName = issueBranchName({ number: 123, title: "Short title" });
    const first = await engine.createSession({ projectId: project.id, workspaceMode: "worktree", title: "#123 Short title", branchName });
    expect(first.worktreeBranch).toBe("capsule/issue-123-short-title");
    // The same issue again cannot reuse the branch, so it gets the thread's suffix.
    const second = await engine.createSession({ projectId: project.id, workspaceMode: "worktree", branchName });
    expect(second.worktreeBranch).toMatch(/^capsule\/issue-123-short-title-[a-z0-9]+$/);
    // A name cannot leave the branch namespace or carry characters git rejects.
    const odd = await engine.createSession({ projectId: project.id, workspaceMode: "worktree", branchName: "../issue 9~^:x" });
    expect(odd.worktreeBranch).toBe("capsule/issue-9-x");
  } finally {
    await engine.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("says plainly why a folder without a repository has no issues", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-issue-"));
  const engine = new CapsuleEngine({ databasePath: ":memory:", userDataDir: directory, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Plain folder", workingDirectory: directory });
    expect(await engine.listGithubIssues(project.id)).toEqual({ error: expect.stringMatching(/not a Git repository/) });
  } finally {
    await engine.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

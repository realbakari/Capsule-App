import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parseGitRefName } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitFile(cwd: string, file: string, text: string) {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", file);
}

it("starts worktree threads from the project's base and from a pull request", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-pr-thread-"));
  const origin = path.join(dir, "origin.git");
  const seed = path.join(dir, "seed");
  git(dir, "init", "--bare", "-b", "main", origin);
  git(dir, "init", "-b", "main", seed);
  git(seed, "config", "user.email", "fixture@example.test");
  git(seed, "config", "user.name", "Capsule Test");
  commitFile(seed, "README.md", "base\n");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(seed, "switch", "-qc", "release");
  commitFile(seed, "RELEASE.md", "release\n");
  git(seed, "push", "-q", "origin", "release");
  git(seed, "switch", "-qc", "contributor", "main");
  commitFile(seed, "pr.txt", "pull request\n");
  git(seed, "push", "-q", "origin", "HEAD:refs/pull/1/head");
  const clone = path.join(dir, "clone");
  git(dir, "clone", "-q", origin, clone);

  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Fixture", workingDirectory: clone });
    expect((await engine.listWorktreeBases(project.id)).defaultRef).toBe("origin/main");

    engine.updateProject(project.id, { defaultWorktreeBaseRef: "origin/release" });
    expect(engine.getProject(project.id)?.defaultWorktreeBaseRef).toBe("origin/release");
    expect(() => engine.updateProject(project.id, { defaultWorktreeBaseRef: "--evil" })).toThrow();
    const fromDefault = await engine.createSession({ projectId: project.id, title: "Release work", workspaceMode: "worktree" });
    expect(fromDefault.worktreeBaseRef).toBe("origin/release");
    expect(readFileSync(path.join(fromDefault.workingDirectory!, "RELEASE.md"), "utf8")).toBe("release\n");

    const moved = await engine.setSessionWorktreeBase(fromDefault.id, parseGitRefName("origin/main")!);
    expect(moved.worktreeBaseRef).toBe("origin/main");
    expect(engine.listSessions(project.id).find((item) => item.id === fromDefault.id)?.worktreeBaseRef).toBe("origin/main");

    const pr = { projectId: project.id, number: 1, title: "Add a file", url: "https://example.test/acme/app/pull/1" };
    const started = await engine.startPullRequestThread({ ...pr, headRefName: "contributor", target: "worktree" });
    expect(started.session.workspaceMode).toBe("worktree");
    expect(started.session.worktreeBranch).toBe("capsule/pr-1");
    expect(readFileSync(path.join(started.session.workingDirectory!, "pr.txt"), "utf8")).toBe("pull request\n");
    expect(started.draft).toContain("#1: Add a file");
    expect(started.draft).toContain(pr.url);
    expect(git(clone, "branch", "--show-current")).toBe("main");

    const again = await engine.startPullRequestThread({ ...pr, target: "worktree" });
    expect(again.session.worktreeBranch).toBe("capsule/pr-1-2");

    const local = await engine.startPullRequestThread({ ...pr, target: "local" });
    expect(local.session.workspaceMode).toBe("local");
    expect(git(clone, "branch", "--show-current")).toBe("capsule/pr-1-3");
    expect(readFileSync(path.join(clone, "pr.txt"), "utf8")).toBe("pull request\n");

    await expect(engine.startPullRequestThread({ ...pr, number: 404, target: "worktree" })).rejects.toThrow(/#404/);
  } finally {
    await engine.stop();
  }
});

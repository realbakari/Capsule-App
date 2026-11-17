import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

const remote = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@capsule/filesystem", async (original) => ({
  ...await original<typeof import("@capsule/filesystem")>(),
  enrichGitStatus: async (status: object) => status,
  createPullRequest: remote.create,
}));

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  remote.create.mockReset();
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-git-actions-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, "remote.git");
  const work = path.join(root, "work");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git(root, "init", "--bare", "-b", "main", bare);
  git(root, "init", "-b", "main", work);
  git(work, "config", "user.email", "fixture@example.test");
  git(work, "config", "user.name", "Capsule Test");
  writeFileSync(path.join(work, "README.md"), "initial\n");
  git(work, "add", "README.md");
  git(work, "commit", "-m", "initial");
  git(work, "remote", "add", "backup", bare);
  git(work, "push", "-u", "backup", "main");
  git(work, "remote", "set-head", "backup", "main");
  const engine = new CapsuleEngine({ databasePath: ":memory:", userDataDir: root, autoConnect: false });
  await engine.start();
  cleanup.push(() => engine.stop());
  const project = engine.createProject({ name: "Git fixture", workingDirectory: work });
  return { engine, project, work, bare, git };
}

it("commits the index as staged, and refuses rather than adding everything when nothing is", async () => {
  const { engine, project, work, git } = await setup();
  writeFileSync(path.join(work, "README.md"), "edited\n");
  writeFileSync(path.join(work, "notes.txt"), "draft\n");
  await expect(engine.gitCommit(project.id, "Nothing staged")).rejects.toThrow("Nothing is staged");
  git(work, "add", "README.md");
  const status = await engine.gitCommit(project.id, "Edit readme", undefined, { staged: true });
  expect(git(work, "show", "--name-only", "--format=", "HEAD")).toBe("README.md");
  expect(status.files.map((file) => [file.code, file.path])).toEqual([["??", "notes.txt"]]);
});

it("asks before pushing to the default branch, and pushes once confirmed", async () => {
  const { engine, project, work, bare, git } = await setup();
  git(work, "commit", "--allow-empty", "-m", "On main");
  await expect(engine.gitPush(project.id)).rejects.toThrow("main is the default branch");
  expect(git(bare, "log", "-1", "--format=%s", "main")).toBe("initial");
  const status = await engine.gitPush(project.id, undefined, { toDefaultBranch: true });
  expect(git(bare, "log", "-1", "--format=%s", "main")).toBe("On main");
  expect(status).toMatchObject({ upstream: "backup/main", ahead: 0, defaultBranch: "main" });
});

it("will not open a pull request from the default branch, and describes one from a feature branch by its commits", async () => {
  const { engine, project, work, bare, git } = await setup();
  git(work, "commit", "--allow-empty", "-m", "On main");
  await expect(engine.gitCreatePullRequest(project.id)).rejects.toThrow("main is the default branch");
  expect(git(bare, "log", "-1", "--format=%s", "main")).toBe("initial");
  git(work, "checkout", "-b", "feature");
  git(work, "commit", "--allow-empty", "-m", "Add limit");
  remote.create.mockResolvedValue({ ok: true, detail: "Opened pull request." });
  await engine.gitCreatePullRequest(project.id, { title: "Rate limit" });
  expect(git(bare, "log", "-1", "--format=%s", "feature")).toBe("Add limit");
  expect(remote.create).toHaveBeenCalledWith(work, expect.objectContaining({ title: "Rate limit", body: "- On main\n- Add limit" }));
});

it("pulls through the engine and fetches so behind is fresh", async () => {
  const { engine, project, work, bare, git } = await setup();
  const other = path.join(path.dirname(work), "other");
  git(path.dirname(work), "clone", bare, other);
  git(other, "config", "user.email", "fixture@example.test");
  git(other, "config", "user.name", "Capsule Test");
  git(other, "commit", "--allow-empty", "-m", "Theirs");
  git(other, "push");
  expect(await engine.gitFetch(project.id)).toBe(true);
  expect((await engine.gitStatus(project.id)).behind).toBe(1);
  const pulled = await engine.gitPull(project.id);
  expect(pulled).toMatchObject({ behind: 0, ahead: 0 });
  expect(git(work, "log", "-1", "--format=%s")).toBe("Theirs");
});

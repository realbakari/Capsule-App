import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";
import { worktreesDirectory } from "./worktree-location.js";

it("validates host paths, including symlinks, without creating folders", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-worktree-path-")));
  try {
    expect(worktreesDirectory("", dir)).toBe(path.join(dir, "worktrees"));
    expect(worktreesDirectory("~/capsule-worktrees", dir)).toBe(path.join(realpathSync(homedir()), "capsule-worktrees"));
    expect(worktreesDirectory(path.join(dir, "new", "worktrees"), dir)).toBe(path.join(dir, "new", "worktrees"));
    expect(existsSync(path.join(dir, "new"))).toBe(false);
    expect(() => worktreesDirectory("relative/folder", dir)).toThrow("absolute");
    expect(() => worktreesDirectory(path.parse(dir).root, dir)).toThrow("root of a drive");
    writeFileSync(path.join(dir, "file"), "keep");
    expect(() => worktreesDirectory(path.join(dir, "file", "child"), dir)).toThrow("must be a folder");
    if (process.platform !== "win32") {
      symlinkSync("/", path.join(dir, "root-link"));
      expect(() => worktreesDirectory(path.join(dir, "root-link"), dir)).toThrow("root of a drive");
      expect(() => worktreesDirectory("C:\\worktrees", dir)).toThrow("absolute");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("persists the location, applies it only to new conversations, and resets without moving existing work", async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-worktree-storage-")));
  const repository = path.join(dir, "repository");
  const custom = path.join(dir, "another drive", "worktrees");
  mkdirSync(repository);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
  git("init"); git("config", "user.email", "capsule@example.test"); git("config", "user.name", "Capsule Test");
  writeFileSync(path.join(repository, "README.md"), "initial\n");
  git("add", "README.md"); git("commit", "-m", "initial");
  const options = { databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    await engine.updateSettings({ worktreesDirectory: custom });
    await expect(engine.updateSettings({ worktreesDirectory: "relative/path" })).rejects.toThrow("absolute");
    expect(engine.getSettings().worktreesDirectory).toBe(custom);
    const project = engine.createProject({ name: "Storage", workingDirectory: repository });
    const first = await engine.createSession({ projectId: project.id, title: "Custom", workspaceMode: "worktree" });
    expect(first.workingDirectory).toBe(path.join(custom, project.id, first.id));
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    expect(engine.getSettings().worktreesDirectory).toBe(custom);
    await engine.updateSettings({ worktreesDirectory: "" });
    const second = await engine.createSession({ projectId: project.id, title: "Default", workspaceMode: "worktree" });
    expect(second.workingDirectory).toBe(path.join(dir, "worktrees", project.id, second.id));
    expect(engine.listSessions(project.id).find((session) => session.id === first.id)?.workingDirectory).toBe(first.workingDirectory);
    expect(existsSync(path.join(first.workingDirectory!, "README.md"))).toBe(true);
    await engine.deleteSession(first.id);
    expect(existsSync(first.workingDirectory!)).toBe(false);
    expect(existsSync(second.workingDirectory!)).toBe(true);
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

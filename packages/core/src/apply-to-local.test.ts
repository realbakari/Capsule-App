import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

describe("apply a worktree conversation to the project folder", { timeout: 60_000 }, () => {
  it("applies, reports the apply until undone, and refuses a local conversation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-apply-engine-"));
    const repository = path.join(dir, "repository");
    mkdirSync(repository);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "capsule@example.test");
    git("config", "user.name", "Capsule Test");
    writeFileSync(path.join(repository, "README.md"), "base\n");
    git("add", "README.md");
    git("commit", "-qm", "initial");

    const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
    await engine.start();
    try {
      const project = engine.createProject({ name: "Apply", workingDirectory: repository });
      const local = await engine.createSession({ projectId: project.id, title: "Shared folder" });
      expect(await engine.worktreeApplyStatus(local.id)).toMatchObject({ available: false, reason: expect.stringMatching(/own worktree/) });
      expect((await engine.applyWorktreeToLocal(local.id)).applied).toBe(false);

      const session = await engine.createSession({ projectId: project.id, title: "Isolated", workspaceMode: "worktree" });
      expect(await engine.worktreeApplyStatus(session.id)).toMatchObject({ available: false, files: 0 });

      writeFileSync(path.join(session.workingDirectory!, "feature.txt"), "from the worktree\n");
      expect(await engine.worktreeApplyStatus(session.id)).toMatchObject({ available: true, files: 1 });

      const result = await engine.applyWorktreeToLocal(session.id);
      expect(result).toMatchObject({ applied: true, files: ["feature.txt"], conflicts: [] });
      expect(result.undoRef).toMatch(/^refs\/capsule\/apply-undo\//);
      expect(readFileSync(path.join(repository, "feature.txt"), "utf8")).toBe("from the worktree\n");
      expect((await engine.worktreeApplyStatus(session.id)).lastApply?.undoRef).toBe(result.undoRef);

      expect((await engine.undoApplyToLocal(local.id, result.undoRef!)).ok).toBe(false);
      expect((await engine.undoApplyToLocal(session.id, result.undoRef!)).ok).toBe(true);
      expect(existsSync(path.join(repository, "feature.txt"))).toBe(false);
      expect((await engine.worktreeApplyStatus(session.id)).lastApply).toBeUndefined();

      await engine.applyWorktreeToLocal(session.id);
      await engine.deleteSession(session.id);
      expect(git("for-each-ref", "refs/capsule/apply-undo/")).toBe("");
    } finally {
      await engine.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

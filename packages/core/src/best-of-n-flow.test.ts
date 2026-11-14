import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function open() {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-best-of-n-"));
  const repository = path.join(dir, "repository");
  mkdirSync(repository);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "capsule@example.test");
  git("config", "user.name", "Capsule Test");
  writeFileSync(path.join(repository, "README.md"), "base\n");
  git("add", "README.md");
  git("commit", "-qm", "initial");
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => engine.stop());
  const project = engine.createProject({ name: "Compare", workingDirectory: repository });
  return { engine, project, repository, git };
}

const latest = (engine: CapsuleEngine, sessionId: string) => engine.listRuns(sessionId)[0];

async function settled(engine: CapsuleEngine, sessionIds: string[]) {
  await vi.waitFor(() => {
    for (const id of sessionIds) expect(["completed", "failed"]).toContain(latest(engine, id)?.status);
  }, { timeout: 15_000 });
}

describe("best-of-N on the mock runtime", { timeout: 60_000 }, () => {
  it("sends one prompt to each agent in its own worktree thread, two of the same agent included", async () => {
    const { engine, project } = await open();
    const before = engine.repos.getProject(project.id);
    const { group, sessionIds } = await engine.startBestOfN({
      projectId: project.id,
      prompt: "Add a greeting",
      candidates: [{ harnessId: "claude" }, { harnessId: "codex" }, { harnessId: "claude", model: "second-model" }],
    });
    expect(sessionIds).toHaveLength(3);
    await settled(engine, sessionIds);

    const threads = sessionIds.map((id) => engine.repos.getSession(id)!);
    expect(threads.map((thread) => thread.groupId)).toEqual([group.id, group.id, group.id]);
    expect(threads.every((thread) => thread.workspaceMode === "worktree")).toBe(true);
    expect(new Set(threads.map((thread) => thread.workingDirectory)).size).toBe(3);
    expect(new Set(threads.map((thread) => thread.worktreeBranch)).size).toBe(3);
    expect(new Set(threads.map((thread) => thread.openclawSessionKey)).size).toBe(3);
    expect(threads.map((thread) => thread.harnessId)).toEqual(["claude", "codex", "claude"]);
    expect(threads[2]!.modelOverride).toBe("second-model");
    expect(threads.map((thread) => thread.title)).toEqual(["Add a greeting · Claude Code", "Add a greeting · Codex", "Add a greeting · Claude Code/second-model"]);
    expect(sessionIds.map((id) => engine.listRuns(id).map((run) => run.prompt))).toEqual([["Add a greeting"], ["Add a greeting"], ["Add a greeting"]]);
    expect(engine.listThreadGroups()).toEqual([expect.objectContaining({ id: group.id, prompt: "Add a greeting", candidates: [
      { sessionId: sessionIds[0], harnessId: "claude", model: "" },
      { sessionId: sessionIds[1], harnessId: "codex", model: "" },
      { sessionId: sessionIds[2], harnessId: "claude", model: "second-model" },
    ] })]);
    // Starting each agent made it the project's default; a comparison leaves the default as it was.
    await vi.waitFor(() => expect(engine.repos.getProject(project.id)?.defaultAgentId).toBe(before?.defaultAgentId));
  });

  it("refuses a project that is not a Git repository, and makes no threads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-best-of-n-plain-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
    await engine.start();
    cleanups.push(() => engine.stop());
    const project = engine.createProject({ name: "Plain", workingDirectory: dir });
    await expect(engine.startBestOfN({ projectId: project.id, prompt: "Go", candidates: [{ harnessId: "claude" }, { harnessId: "codex" }] })).rejects.toThrow(/Git repository/);
    expect(engine.listSessions().filter((session) => session.projectId === project.id)).toHaveLength(0);
  });

  it("shows a failed candidate in the comparison while the others finish", async () => {
    const { engine, project } = await open();
    const spawn = (engine as unknown as { spawnHarness: (input: { harnessId: string }) => Promise<unknown> }).spawnHarness.bind(engine);
    vi.spyOn(engine as never, "spawnHarness" as never).mockImplementation(((input: { harnessId: string }) =>
      input.harnessId === "codex" ? Promise.reject(new Error("Codex is installed but not signed in.")) : spawn(input)) as never);
    const { group, sessionIds } = await engine.startBestOfN({ projectId: project.id, prompt: "Fix it", candidates: [{ harnessId: "claude" }, { harnessId: "codex" }, { harnessId: "grok" }] });
    await settled(engine, sessionIds);
    const comparison = await engine.compareThreadGroup(group.id);
    expect(comparison.candidates.map((candidate) => candidate.run?.status)).toEqual(["completed", "failed", "completed"]);
    expect(comparison.candidates[1]!.run?.error).toMatch(/not signed in/);
    expect(comparison.candidates[0]!.reply).toBeTruthy();
    expect(comparison.candidates[0]!.diff).toEqual({ files: [], added: 0, removed: 0 });
    expect(comparison.candidates.every((candidate) => candidate.worktree === "present")).toBe(true);
  });

  it("keeps a winner by applying it, and undoing the apply undoes the keep", async () => {
    const { engine, project, repository } = await open();
    const { group, sessionIds } = await engine.startBestOfN({ projectId: project.id, prompt: "Write a note", candidates: [{ harnessId: "claude" }, { harnessId: "codex" }] });
    await settled(engine, sessionIds);
    const [winner] = sessionIds.map((id) => engine.repos.getSession(id)!);
    writeFileSync(path.join(winner!.workingDirectory!, "note.txt"), "one\ntwo\n");

    const comparison = await engine.compareThreadGroup(group.id);
    expect(comparison.candidates[0]!.diff).toEqual({ files: [{ path: "note.txt", added: 2, removed: 0 }], added: 2, removed: 0 });

    const result = await engine.keepCandidate(group.id, winner!.id);
    expect(result).toMatchObject({ applied: true, files: ["note.txt"], conflicts: [] });
    expect(readFileSync(path.join(repository, "note.txt"), "utf8")).toBe("one\ntwo\n");
    expect(engine.listThreadGroups()[0]).toMatchObject({ winnerSessionId: winner!.id, decidedAt: expect.any(String) });
    expect(engine.resultsLeaderboard()).toEqual([
      { harnessId: "claude", model: "", compared: 1, kept: 1, up: 0, down: 0 },
      { harnessId: "codex", model: "", compared: 1, kept: 0, up: 0, down: 0 },
    ]);

    expect((await engine.undoApplyToLocal(winner!.id, result.undoRef!)).ok).toBe(true);
    expect(engine.listThreadGroups()[0]!.winnerSessionId).toBeUndefined();
    await expect(engine.keepCandidate(group.id, "sess_not_here")).rejects.toThrow(/not part of this comparison/);
  });

  it("sets the others aside with their work saved, and restoring one brings its worktree back", async () => {
    const { engine, project, git } = await open();
    const { group, sessionIds } = await engine.startBestOfN({ projectId: project.id, prompt: "Try it", candidates: [{ harnessId: "claude" }, { harnessId: "codex" }, { harnessId: "grok" }] });
    await settled(engine, sessionIds);
    const [winner, loser, other] = sessionIds.map((id) => engine.repos.getSession(id)!);
    await expect(engine.setAsideCandidates(group.id)).rejects.toThrow(/Keep one candidate first/);
    writeFileSync(path.join(winner!.workingDirectory!, "kept.txt"), "kept\n");
    writeFileSync(path.join(loser!.workingDirectory!, "README.md"), "changed by the loser\n");
    writeFileSync(path.join(loser!.workingDirectory!, "untracked.txt"), "new file\n");
    await engine.keepCandidate(group.id, winner!.id);

    const { archived, failed } = await engine.setAsideCandidates(group.id);
    expect(failed).toEqual([]);
    expect(archived.sort()).toEqual([loser!.id, other!.id].sort());
    expect(existsSync(loser!.workingDirectory!)).toBe(false);
    expect(engine.repos.getSession(loser!.id)?.state).toBe("archived");
    expect(engine.repos.getSession(winner!.id)?.state).toBe("active");
    expect(git("branch", "--list", loser!.worktreeBranch!).trim()).not.toBe("");
    const aside = await engine.compareThreadGroup(group.id);
    expect(aside.candidates.map((candidate) => [candidate.archived, candidate.worktree])).toEqual([[false, "present"], [true, "set-aside"], [true, "set-aside"]]);

    const restored = await engine.restoreSession(loser!.id);
    expect(restored.state).toBe("active");
    expect(readFileSync(path.join(loser!.workingDirectory!, "README.md"), "utf8")).toBe("changed by the loser\n");
    expect(readFileSync(path.join(loser!.workingDirectory!, "untracked.txt"), "utf8")).toBe("new file\n");
    expect((await engine.compareThreadGroup(group.id)).candidates[1]).toMatchObject({ archived: false, worktree: "present", diff: { added: 2 } });
  });

  it("rates final replies by agent and model, and a second rating replaces the first", async () => {
    const { engine, project } = await open();
    const { group, sessionIds } = await engine.startBestOfN({ projectId: project.id, prompt: "Explain", candidates: [{ harnessId: "claude", model: "fast" }, { harnessId: "codex" }] });
    await settled(engine, sessionIds);
    const [first, second] = sessionIds.map((id) => latest(engine, id)!);
    engine.rateRun(first!.id, 1);
    engine.rateRun(second!.id, 1);
    engine.rateRun(second!.id, -1);
    expect(engine.runRatings(sessionIds[1]!)).toEqual({ [second!.id]: -1 });
    expect((await engine.compareThreadGroup(group.id)).candidates.map((candidate) => candidate.rating)).toEqual([1, -1]);
    expect(engine.resultsLeaderboard()).toEqual([
      { harnessId: "claude", model: "fast", compared: 1, kept: 0, up: 1, down: 0 },
      { harnessId: "codex", model: "", compared: 1, kept: 0, up: 0, down: 1 },
    ]);
    engine.rateRun(first!.id, 0);
    expect(engine.runRatings(sessionIds[0]!)).toEqual({});
  });
});

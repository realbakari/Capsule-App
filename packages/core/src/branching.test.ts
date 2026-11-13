import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
import type { Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const engines: CapsuleEngine[] = [];
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-branching-"));
  const repo = path.join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
  writeFileSync(path.join(repo, "notes.txt"), "base\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  engines.push(engine);
  await engine.start();
  const project = engine.createProject({ name: "Repo", workingDirectory: repo });
  const session = await engine.createSession({ projectId: project.id, title: "Thread", mode: "chat", agentId: "general" });
  /** One turn that leaves notes.txt reading `text`, with its checkpoint recorded. */
  const turn = async (text: string, target: Session = session) => {
    writeFileSync(path.join(repo, "notes.txt"), `${text}\n`);
    const { run } = await engine.sendMessage({ sessionId: target.id, content: text });
    for (let waited = 0; !engine.getRun(run.id)?.checkpointRef && waited < 10_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(engine.getRun(run.id)?.checkpointRef).toBeTruthy();
    return run.id;
  };
  const notes = () => readFileSync(path.join(repo, "notes.txt"), "utf8").trim();
  const prompts = (id = session.id) => engine.listMessages(id).filter((message) => message.role === "user").map((message) => message.content);
  return { dir, repo, engine, project, session, turn, notes, prompts };
}

describe("restoring a turn", () => {
  it("restores only the files, keeps every message, and Redo puts the folder back", async () => {
    const { engine, session, repo, turn, notes, prompts } = await setup();
    const first = await turn("one");
    await turn("two");
    await turn("three");
    writeFileSync(path.join(repo, "notes.txt"), "edited by hand\n");
    const compare = await engine.compareCheckpoint(first);
    expect(compare.files.map((file) => file.path)).toEqual(["notes.txt"]);
    expect(compare.patch).toContain("-edited by hand");
    expect(compare.patch).toContain("+one");

    const result = await engine.restoreToTurn({ runId: first, scope: "files" });
    expect(result).toMatchObject({ ok: true, filesRestored: true, removedMessages: 0 });
    expect(notes()).toBe("one");
    expect(prompts()).toEqual(["one", "two", "three"]);
    expect(engine.redoPoint(session.id)).toMatchObject({ scope: "files", filesSaved: true, targetRunId: first });

    expect((await engine.redoRestore(session.id)).ok).toBe(true);
    expect(notes()).toBe("edited by hand");
    expect(engine.redoPoint(session.id)).toBeUndefined();
  });

  it("restores only the conversation, leaves the files, and Redo brings the turns back", async () => {
    const { engine, session, turn, notes, prompts } = await setup();
    const first = await turn("one");
    const second = await turn("two");
    await turn("three");

    const result = await engine.restoreToTurn({ runId: first, scope: "conversation" });
    expect(result).toMatchObject({ ok: true, filesRestored: false });
    expect(notes()).toBe("three");
    expect(prompts()).toEqual(["one"]);
    expect(engine.getRun(second)).toBeUndefined();
    const restored = engine.listSessions().find((item) => item.id === session.id)!;
    expect(restored.openclawSessionKey).toBeUndefined();
    expect(restored.carryOver?.replayTranscript).toBe(true);

    expect((await engine.redoRestore(session.id)).ok).toBe(true);
    expect(prompts()).toEqual(["one", "two", "three"]);
    expect(engine.getRun(second)?.checkpointRef).toBeTruthy();
    expect(notes()).toBe("three");
  });

  it("restores both, and Redo reverses both", async () => {
    const { engine, session, turn, notes, prompts } = await setup();
    const first = await turn("one");
    await turn("two");

    expect((await engine.restoreToTurn({ runId: first, scope: "both" })).ok).toBe(true);
    expect(notes()).toBe("one");
    expect(prompts()).toEqual(["one"]);

    expect((await engine.redoRestore(session.id)).ok).toBe(true);
    expect(notes()).toBe("two");
    expect(prompts()).toEqual(["one", "two"]);
  });

  it("forgets Redo once a new turn happens, and says so", async () => {
    const { engine, session, turn, prompts } = await setup();
    const first = await turn("one");
    await turn("two");
    expect((await engine.restoreToTurn({ runId: first, scope: "both" })).ok).toBe(true);
    await turn("another way");
    expect(engine.redoPoint(session.id)).toBeUndefined();
    const refused = await engine.redoRestore(session.id);
    expect(refused.ok).toBe(false);
    expect(prompts()).toEqual(["one", "another way"]);
  });

  it("tells the next prompt about the kept turns once", async () => {
    const { engine, session, turn } = await setup();
    const first = await turn("one");
    await turn("two");
    await engine.restoreToTurn({ runId: first, scope: "conversation" });
    const next = await turn("next");
    const events = engine.listRunEvents(next).map((event) => event.message);
    expect(events.some((message) => message.startsWith("Carried the earlier conversation"))).toBe(true);
    expect(engine.listSessions().find((item) => item.id === session.id)!.carryOver?.replayTranscript).toBeUndefined();
    const after = await turn("after");
    expect(engine.listRunEvents(after).some((event) => event.message.startsWith("Carried"))).toBe(false);
  });

  it("makes Edit from here redoable too", async () => {
    const { engine, session, turn, prompts } = await setup();
    await turn("one");
    await turn("two");
    const prompt = engine.listMessages(session.id).find((message) => message.content === "two")!;
    const result = await engine.rewindSession(session.id, prompt.id);
    expect(result).toMatchObject({ ok: true, prompt: "two" });
    expect(result.redo).toMatchObject({ edit: true, scope: "conversation" });
    expect(prompts()).toEqual(["one"]);
    expect((await engine.redoRestore(session.id)).ok).toBe(true);
    expect(prompts()).toEqual(["one", "two"]);
  });
});

describe("forking a thread", () => {
  it("copies exactly up to the turn and leaves the original untouched", async () => {
    const { engine, session, turn, prompts } = await setup();
    await turn("one");
    const second = await turn("two");
    await turn("three");
    const originalMessages = engine.listMessages(session.id);
    const originalRuns = engine.listRuns(session.id);

    const fork = await engine.forkSession({ sessionId: session.id, runId: second, workspace: "same" });
    expect(fork.title).toBe("Thread (fork)");
    expect(fork.forkedFrom).toEqual({ sessionId: session.id, runId: second });
    expect(fork.carryOver?.replayTranscript).toBe(true);
    expect(prompts(fork.id)).toEqual(["one", "two"]);
    const copiedReplies = engine.listMessages(fork.id).filter((message) => message.role === "assistant").map((message) => message.content);
    expect(copiedReplies).toEqual(originalMessages.filter((message) => message.role === "assistant").slice(0, 2).map((message) => message.content));
    expect(engine.listRuns(fork.id)).toHaveLength(2);
    expect(engine.listRuns(fork.id).every((run) => !originalRuns.some((original) => original.id === run.id))).toBe(true);

    expect(engine.listMessages(session.id)).toEqual(originalMessages);
    expect(engine.listRuns(session.id).map((run) => run.id)).toEqual(originalRuns.map((run) => run.id));

    // The copy owns its checkpoints: its turn diff still reads after the original is gone.
    const copiedSecond = engine.listRuns(fork.id).find((run) => run.prompt === "two")!;
    const diff = await engine.turnDiff(copiedSecond.id);
    expect(diff.files.map((file) => file.path)).toEqual(["notes.txt"]);
  });

  it("starts a worktree fork with the files exactly as the turn left them", async () => {
    const { engine, session, repo, turn, notes } = await setup();
    await turn("one");
    const second = await turn("two");
    writeFileSync(path.join(repo, "extra.txt"), "untracked, written after turn two\n");
    await turn("three");
    const fork = await engine.forkSession({ sessionId: session.id, runId: second, workspace: "worktree" });
    expect(fork.workspaceMode).toBe("worktree");
    expect(fork.workingDirectory).toBeTruthy();
    expect(readFileSync(path.join(fork.workingDirectory!, "notes.txt"), "utf8").trim()).toBe("two");
    expect(existsSync(path.join(fork.workingDirectory!, "extra.txt"))).toBe(false);
    expect(notes()).toBe("three");
    expect(engine.listRuns(fork.id).every((run) => run.workingDirectory === fork.workingDirectory)).toBe(true);
  });

  it("lists branches at the fork point, original first, from either side", async () => {
    const { engine, session, turn } = await setup();
    await turn("one");
    const second = await turn("two");
    await turn("three");
    const a = await engine.forkSession({ sessionId: session.id, runId: second, workspace: "same" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await engine.forkSession({ sessionId: session.id, runId: second, workspace: "same" });
    const copiedSecond = engine.listRuns(a.id).find((run) => run.prompt === "two")!;
    // Forking a fork at a copied turn joins the same group.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const c = await engine.forkSession({ sessionId: a.id, runId: copiedSecond.id, workspace: "same" });
    expect(c.forkedFrom).toEqual({ sessionId: session.id, runId: second });

    const fromOriginal = engine.forkBranches(session.id);
    expect(fromOriginal).toHaveLength(1);
    expect(fromOriginal[0]).toMatchObject({ anchorRunId: second, currentIndex: 0 });
    expect(fromOriginal[0]!.branches.map((branch) => branch.sessionId)).toEqual([session.id, a.id, b.id, c.id]);
    expect(fromOriginal[0]!.branches[0]).toMatchObject({ original: true, turnsSince: 1 });
    expect(fromOriginal[0]!.branches[1]).toMatchObject({ original: false, turnsSince: 0 });

    const fromFork = engine.forkBranches(a.id);
    expect(fromFork[0]).toMatchObject({ anchorRunId: copiedSecond.id, currentIndex: 1 });
  });
});

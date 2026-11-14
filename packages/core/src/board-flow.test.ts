import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(directory = mkdtempSync(path.join(tmpdir(), "capsule-board-"))) {
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false };
  const engine = new CapsuleEngine(options);
  await engine.start();
  cleanups.push(async () => { await engine.stop(); });
  return { engine, directory };
}

const turns = (engine: CapsuleEngine, sessionId: string) => engine.listRuns(sessionId);

async function settled(engine: CapsuleEngine, sessionId: string, status = "completed") {
  await vi.waitFor(() => expect(turns(engine, sessionId).at(-1)?.status).toBe(status), { timeout: 8000 });
}

describe("board chains", { timeout: 20_000 }, () => {
  it("starts each dependent once, only after the card before it is marked done", async () => {
    const { engine, directory } = await open();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const project = engine.createProject({ name: "Chain", workingDirectory: directory });
    const a = await engine.createBoardCard({ projectId: project.id, title: "A", prompt: "First step", dependsOn: [], autoStart: false });
    const b = await engine.createBoardCard({ projectId: project.id, title: "B", prompt: "Second step", dependsOn: [a.id], autoStart: true });
    const c = await engine.createBoardCard({ projectId: project.id, title: "C", prompt: "Third step", dependsOn: [b.id], autoStart: true });
    expect(turns(engine, a.id)).toHaveLength(0);

    await engine.updateBoardCard(a.id, { type: "start" });
    await settled(engine, a.id);
    expect(engine.repos.getSession(a.id)?.pendingStart).toBeUndefined();
    expect(turns(engine, b.id)).toHaveLength(0);

    await engine.updateBoardCard(a.id, { type: "done" });
    await settled(engine, b.id);
    expect(turns(engine, b.id).map((run) => run.prompt)).toEqual(["Second step"]);
    expect(turns(engine, c.id)).toHaveLength(0);

    await engine.updateBoardCard(a.id, { type: "reopen" });
    await engine.updateBoardCard(a.id, { type: "done" });
    await engine.updateBoardCard(b.id, { type: "done" });
    await settled(engine, c.id);
    expect(turns(engine, b.id)).toHaveLength(1);
    expect(turns(engine, c.id)).toHaveLength(1);
  });

  it("holds a dependent whose card failed until someone starts it anyway", async () => {
    const { engine, directory } = await open();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const project = engine.createProject({ name: "Blocked", workingDirectory: directory });
    const a = await engine.createBoardCard({ projectId: project.id, title: "A", prompt: "Break [fail]", dependsOn: [], autoStart: false, start: true });
    const b = await engine.createBoardCard({ projectId: project.id, title: "B", prompt: "Next", dependsOn: [a.id], autoStart: true });
    await settled(engine, a.id, "failed");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(turns(engine, b.id)).toHaveLength(0);
    expect(engine.repos.getSession(b.id)?.pendingStart?.prompt).toBe("Next");
    await engine.updateBoardCard(b.id, { type: "start" });
    await settled(engine, b.id);
  });

  it("refuses a link that would make two cards wait for each other", async () => {
    const { engine, directory } = await open();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const project = engine.createProject({ name: "Cycle", workingDirectory: directory });
    const a = await engine.createBoardCard({ projectId: project.id, prompt: "One", dependsOn: [], autoStart: true });
    const b = await engine.createBoardCard({ projectId: project.id, prompt: "Two", dependsOn: [a.id], autoStart: true });
    await expect(engine.updateBoardCard(a.id, { type: "link", dependsOn: b.id })).rejects.toThrow("wait for each other");
    await expect(engine.updateBoardCard(a.id, { type: "link", dependsOn: a.id })).rejects.toThrow("wait for each other");
    await engine.updateBoardCard(b.id, { type: "unlink", dependsOn: a.id });
    await engine.updateBoardCard(a.id, { type: "link", dependsOn: b.id });
    expect(engine.repos.getSession(a.id)?.pendingStart?.dependsOn).toEqual([b.id]);
    const solo = await engine.createBoardCard({ projectId: project.id, prompt: "Three", dependsOn: [], autoStart: false });
    await engine.updateBoardCard(solo.id, { type: "link", dependsOn: a.id });
    expect(engine.repos.getSession(solo.id)?.pendingStart).toMatchObject({ dependsOn: [a.id], autoStart: true });
    await engine.updateBoardCard(solo.id, { type: "edit", autoStart: false });
    expect(engine.repos.getSession(solo.id)?.pendingStart?.autoStart).toBe(false);
  });

  it("starts what was ready when the app quit, once, after a restart", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "capsule-board-restart-"));
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const first = await open(directory);
    const project = first.engine.createProject({ name: "Restart", workingDirectory: directory });
    const a = await first.engine.createBoardCard({ projectId: project.id, prompt: "First", dependsOn: [], autoStart: false, start: true });
    await settled(first.engine, a.id);
    const b = await first.engine.createBoardCard({ projectId: project.id, prompt: "Second", dependsOn: [a.id], autoStart: true });
    // Marked done, then the app quit before the chain moved.
    first.engine.repos.updateSessionBoard({ ...first.engine.repos.getSession(a.id)!, doneAt: new Date().toISOString() });
    expect(turns(first.engine, b.id)).toHaveLength(0);
    await first.engine.stop();

    const second = await open(directory);
    await settled(second.engine, b.id);
    await second.engine.stop();
    const third = await open(directory);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(turns(third.engine, b.id)).toHaveLength(1);
  });

  it("does not start a draft again once it was sent by hand from its thread", async () => {
    const { engine, directory } = await open();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const project = engine.createProject({ name: "Manual", workingDirectory: directory });
    const a = await engine.createBoardCard({ projectId: project.id, prompt: "One", dependsOn: [], autoStart: false });
    const b = await engine.createBoardCard({ projectId: project.id, prompt: "Two", dependsOn: [a.id], autoStart: true });
    await engine.sendMessage({ sessionId: b.id, content: "Typed by hand" });
    expect(engine.repos.getSession(b.id)?.pendingStart).toBeUndefined();
    await settled(engine, b.id);
    await engine.updateBoardCard(a.id, { type: "start" });
    await settled(engine, a.id);
    await engine.updateBoardCard(a.id, { type: "done" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(turns(engine, b.id)).toHaveLength(1);
  });

  it("hands a card whose prerequisite was deleted back to the person instead of starting it", async () => {
    const { engine, directory } = await open();
    cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
    const project = engine.createProject({ name: "Delete", workingDirectory: directory });
    const a = await engine.createBoardCard({ projectId: project.id, prompt: "One", dependsOn: [], autoStart: false });
    const b = await engine.createBoardCard({ projectId: project.id, prompt: "Two", dependsOn: [a.id], autoStart: true });
    await engine.deleteSession(a.id);
    expect(engine.repos.getSession(b.id)?.pendingStart).toMatchObject({ dependsOn: [], prompt: "Two" });
    expect(turns(engine, b.id)).toHaveLength(0);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CapsuleDatabase } from "@capsule/database";
import { expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

/** Rows anywhere in the database file that mention the thread. */
function rowsInFile(databasePath: string, sessionId: string): Record<string, number> {
  const reader = new CapsuleDatabase(databasePath);
  try {
    const count = (sql: string) => (reader.sqlite.prepare(sql).get(sessionId) as { n: number }).n;
    return {
      sessions: count("SELECT COUNT(*) AS n FROM sessions WHERE id = ?"),
      messages: count("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?"),
      runs: count("SELECT COUNT(*) AS n FROM runs WHERE session_id = ?"),
      events: count("SELECT COUNT(*) AS n FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?)"),
      settings: count("SELECT COUNT(*) AS n FROM settings WHERE key LIKE '%' || ?"),
    };
  } finally { reader.sqlite.close(); }
}

const none = { sessions: 0, messages: 0, runs: 0, events: 0, settings: 0 };

it("never writes a temporary thread to the database file, and Keep moves it there", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-temporary-"));
  const databasePath = path.join(directory, "capsule.sqlite");
  const open = async () => {
    const engine = new CapsuleEngine({ databasePath, userDataDir: directory, autoConnect: false });
    await engine.start();
    return engine;
  };
  try {
    let engine = await open();
    const project = engine.createProject({ name: "Scratch", workingDirectory: directory });
    const kept = await engine.createSession({ projectId: project.id, temporary: true, workspaceMode: "worktree" });
    const dropped = await engine.createSession({ projectId: project.id, temporary: true });
    expect(kept.temporary).toBe(true);
    expect(kept.workspaceMode).toBe("local");

    const turn = await engine.sendMessage({ sessionId: kept.id, content: "Hello", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(turn.run.id)?.completedAt).toBeTruthy(), { timeout: 5000 });
    await engine.sendMessage({ sessionId: dropped.id, content: "Scratch work", mode: "chat" }).then((next) =>
      vi.waitFor(() => expect(engine.getRun(next.run.id)?.completedAt).toBeTruthy(), { timeout: 5000 }));
    engine.setSessionTags(kept.id, ["draft"]);
    engine.renameSession(kept.id, "Worth keeping");

    expect(engine.listSessions(project.id).filter((item) => item.temporary).map((item) => item.id).sort()).toEqual([kept.id, dropped.id].sort());
    expect(engine.listMessages(kept.id).length).toBeGreaterThan(0);
    expect(engine.getRun(turn.run.id)?.checkpointRef).toBeFalsy();
    expect(rowsInFile(databasePath, kept.id)).toEqual(none);
    expect(rowsInFile(databasePath, dropped.id)).toEqual(none);

    const messages = engine.listMessages(kept.id).length;
    const saved = engine.keepSession(kept.id);
    expect(saved.temporary).toBeUndefined();
    expect(saved.title).toBe("Worth keeping");
    expect(saved.tags).toEqual(["draft"]);
    expect(engine.listMessages(kept.id)).toHaveLength(messages);
    const inFile = rowsInFile(databasePath, kept.id);
    expect(inFile).toMatchObject({ sessions: 1, messages, runs: 1 });
    expect(inFile.events).toBeGreaterThan(0);
    await engine.stop();

    engine = await open();
    expect(engine.listSessions(project.id).map((item) => item.id)).toContain(kept.id);
    expect(engine.listSessions(project.id).map((item) => item.id)).not.toContain(dropped.id);
    expect(engine.listMessages(kept.id)).toHaveLength(messages);
    await engine.stop();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("deleting a temporary thread leaves nothing behind in memory or on disk", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-temporary-"));
  const databasePath = path.join(directory, "capsule.sqlite");
  const engine = new CapsuleEngine({ databasePath, userDataDir: directory, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Scratch", workingDirectory: directory });
    const thread = await engine.createSession({ projectId: project.id, temporary: true });
    await engine.deleteSession(thread.id);
    expect(engine.listSessions(project.id).some((item) => item.id === thread.id)).toBe(false);
    expect(rowsInFile(databasePath, thread.id)).toEqual(none);
  } finally {
    await engine.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

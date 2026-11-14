import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isThreadUnread, type Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

async function finished(engine: CapsuleEngine, runId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Run did not finish")), 5000);
    const check = () => {
      if (!["completed", "failed", "cancelled"].includes(engine.getRun(runId)?.status ?? "")) return;
      clearTimeout(timeout);
      engine.events.off("run", check);
      resolve();
    };
    engine.events.on("run", check);
    check();
  });
}

async function withEngine(test: (engine: CapsuleEngine, session: Session) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-triage-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Triage", defaultMode: "chat" });
    const session = await engine.createSession({ projectId: project.id, title: "Thread", mode: "chat", agentId: "general" });
    await test(engine, session);
  } finally {
    await engine.stop();
  }
}

const reread = (engine: CapsuleEngine, id: string) => engine.listSessions().find((session) => session.id === id)!;
const latest = (engine: CapsuleEngine, id: string) => engine.listRuns(id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

describe("thread triage", () => {
  it("reads, marks unread, and never reorders the thread list", async () => {
    await withEngine(async (engine, session) => {
      const { run } = await engine.sendMessage({ sessionId: session.id, content: "hello", agentId: "general", mode: "chat" });
      await finished(engine, run.id);
      expect(isThreadUnread(reread(engine, session.id), latest(engine, session.id))).toBe(true);

      const before = reread(engine, session.id).updatedAt;
      engine.triageSession(session.id, { kind: "viewed" });
      expect(isThreadUnread(reread(engine, session.id), latest(engine, session.id))).toBe(false);
      expect(reread(engine, session.id).updatedAt).toBe(before);

      engine.triageSession(session.id, { kind: "unread" });
      expect(isThreadUnread(reread(engine, session.id), latest(engine, session.id))).toBe(true);
      // An older view time does not undo a newer one.
      engine.triageSession(session.id, { kind: "viewed" });
      engine.triageSession(session.id, { kind: "viewed", at: "2020-01-01T00:00:00.000Z" });
      expect(isThreadUnread(reread(engine, session.id), latest(engine, session.id))).toBe(false);
    });
  });

  it("refuses mark unread before anything finished", async () => {
    await withEngine(async (engine, session) => {
      expect(() => engine.triageSession(session.id, { kind: "unread" })).toThrow(/no finished turn/);
    });
  });

  it("brings a settled or snoozed thread back when a turn starts", async () => {
    await withEngine(async (engine, session) => {
      engine.triageSession(session.id, { kind: "settle" });
      expect(reread(engine, session.id).settledAt).toBeTruthy();
      const { run } = await engine.sendMessage({ sessionId: session.id, content: "more", agentId: "general", mode: "chat" });
      expect(reread(engine, session.id).settledAt).toBeUndefined();
      await finished(engine, run.id);

      engine.triageSession(session.id, { kind: "snooze", until: new Date(Date.now() + 3_600_000).toISOString() });
      expect(reread(engine, session.id).snoozedUntil).toBeTruthy();
      const second = await engine.sendMessage({ sessionId: session.id, content: "again", agentId: "general", mode: "chat" });
      expect(reread(engine, session.id).snoozedUntil).toBeUndefined();
      await finished(engine, second.run.id);
    });
  });

  it("wakes a snoozed thread at its time and says so", async () => {
    await withEngine(async (engine, session) => {
      const woke = new Promise<Session>((resolve) => engine.events.once("session-woke", resolve));
      const until = new Date(Date.now() + 31_000).toISOString();
      engine.triageSession(session.id, { kind: "snooze", until });
      // Pull the time in under the timer instead of waiting half a minute.
      (engine as unknown as { repos: { updateSessionTriage(s: Partial<Session>): void } }).repos.updateSessionTriage({
        id: session.id, snoozedUntil: new Date(Date.now() + 50).toISOString(),
      });
      engine.triageSession(session.id, { kind: "unsettle" });
      expect((await woke).id).toBe(session.id);
      expect(reread(engine, session.id).snoozedUntil).toBeUndefined();
    });
  });
});

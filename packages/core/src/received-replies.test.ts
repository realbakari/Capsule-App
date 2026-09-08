import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Run, RunEvent, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it("keeps streamed and persisted replies once, including snapshots arriving after completion", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-replies-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Reply test" });
    const session = await engine.createSession({ projectId: project.id, mode: "chat" });
    const internal = engine as unknown as {
      usingMock: boolean;
      repos: { insertRun(run: Run): void; updateRun(run: Run): void; updateSession(session: Session): void };
      handleAcpReply(payload: { sessionKey: string; text: string; done: boolean; snapshot?: boolean; timestamp?: number; control?: boolean }): void;
      handleRuntimeEvent(session: Session, run: Run, event: RunEvent, stop: () => void): Promise<void>;
      runtime: { cancelRun(id: string): Promise<void> };
    };
    internal.usingMock = false;
    const key = "agent:claude:acp:reply-test";
    session.openclawSessionKey = key;
    internal.repos.updateSession(session);
    const createdAt = "2026-09-04T07:45:00.000Z";
    const run: Run = { id: "reply-run", projectId: project.id, sessionId: session.id, agentId: "claude", prompt: "Test", status: "running", createdAt, updatedAt: createdAt };
    internal.repos.insertRun(run);
    const reply = (text: string, extra = {}) => internal.handleAcpReply({ sessionKey: key, text, done: true, snapshot: true, timestamp: Date.parse("2026-09-04T07:46:00Z"), ...extra });
    reply("Partial ", { done: false, snapshot: false });
    const progress = "The build reports an unknown command. I will fix the script.";
    reply(progress);
    reply(progress);
    expect(engine.getRun(run.id)?.status).toBe("running");
    reply("Final answer.");
    await internal.handleRuntimeEvent(session, run, {
      id: "late-delta", runId: run.id, type: "assistant", message: "Final answer.", timestamp: createdAt,
    }, () => {});
    expect(engine.listMessages(session.id).map((item) => item.content)).toEqual([progress, "Final answer."]);
    await internal.handleRuntimeEvent(session, run, {
      id: "end", runId: run.id, type: "lifecycle", message: "Completed", timestamp: "2026-09-04T07:47:00Z", data: { status: "completed", output: "" },
    }, () => {});
    expect(engine.getRun(run.id)?.result).toBe(`${progress}\n\nFinal answer.`);
    expect(engine.listMessages(session.id)).toHaveLength(2);

    const newer = { ...run, id: "newer", createdAt: "2026-09-04T07:49:00Z", status: "queued" as const, completedAt: undefined, result: undefined };
    internal.repos.insertRun(newer);
    const cancel = vi.spyOn(internal.runtime, "cancelRun").mockResolvedValue();
    reply("x".repeat(1024 * 1024 + 1), { timestamp: Date.parse("2026-09-04T07:48:00Z") });
    expect(cancel).not.toHaveBeenCalled();
    expect(engine.getRun(newer.id)?.status).toBe("queued");
    reply("Late final answer.", { timestamp: Date.parse("2026-09-04T07:48:00Z") });
    expect(engine.listMessages(session.id).at(-1)?.runId).toBe(run.id);
    expect(engine.getRun(newer.id)?.result).toBeFalsy();
    reply("Late final answer.", { timestamp: Date.parse("2026-09-04T07:48:00Z") });
    expect(engine.listMessages(session.id)).toHaveLength(3);
    reply("ACP status: session details", { control: true });
    expect(engine.listMessages(session.id)).toHaveLength(3);
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["delta", "snapshot", "combined"])("fails bounded %s output, requests cancellation and ignores late replies", async (kind) => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-output-limit-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  try {
    const project = engine.createProject({ name: "Bounded output" });
    const session = await engine.createSession({ projectId: project.id, mode: "chat" });
    const internal = engine as unknown as {
      usingMock: boolean;
      repos: { insertRun(run: Run): void; updateSession(session: Session): void };
      runtime: { cancelRun(id: string): Promise<void> };
      handleAcpReply(payload: { sessionKey: string; text: string; done: boolean }): void;
      handleRuntimeEvent(session: Session, run: Run, event: RunEvent, stop: () => void): Promise<void>;
    };
    internal.usingMock = false;
    session.openclawSessionKey = "agent:claude:acp:limit";
    internal.repos.updateSession(session);
    const at = new Date().toISOString();
    const run: Run = { id: "limit", projectId: project.id, sessionId: session.id, agentId: "claude", prompt: "Bounded", status: "running", createdAt: at, updatedAt: at };
    internal.repos.insertRun(run);
    const cancel = vi.spyOn(internal.runtime, "cancelRun").mockResolvedValue();
    const reply = (text: string) => internal.handleAcpReply({ sessionKey: session.openclawSessionKey!, text, done: true });
    if (kind === "delta") {
      for (let i = 0; i < 17; i++) await internal.handleRuntimeEvent(session, run, {
        id: `delta-${i}`, runId: run.id, type: "assistant", message: "x".repeat(64 * 1024), timestamp: at,
      }, () => {});
    } else if (kind === "snapshot") reply("x".repeat(1024 * 1024 + 1));
    else { reply("x".repeat(600_000)); reply("y".repeat(600_000)); }
    expect(engine.getRun(run.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Cancellation was requested") });
    expect(Buffer.byteLength(engine.getRun(run.id)?.result ?? "")).toBeLessThanOrEqual(1024 * 1024);
    expect(cancel).toHaveBeenCalledOnce();
    const before = engine.listMessages(session.id).length;
    reply("Late response");
    expect(engine.listMessages(session.id)).toHaveLength(before);
  } finally { await engine.stop(); rmSync(dir, { recursive: true, force: true }); }
});

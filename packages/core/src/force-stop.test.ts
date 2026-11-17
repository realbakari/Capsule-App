import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DirectAcpHost } from "@capsule/acp";
import type { Run, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.restoreAllMocks(); });

/** A running turn whose agent is reached through `route`. Nothing real is spawned or contacted. */
async function fixture(route: "direct" | "gateway" | "none") {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-force-stop-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanup.push(async () => { await engine.stop(); rmSync(dir, { recursive: true, force: true }); });
  const project = engine.createProject({ name: "Force stop fixture", workingDirectory: dir });
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  const internal = engine as unknown as {
    usingMock: boolean; direct: DirectAcpHost;
    openclaw: { closeAcp(key: string): Promise<void> };
    runtime: { cancelRun: (id: string) => Promise<void> };
    repos: { insertRun(run: Run): void; updateSession(session: Session): void; getSession(id: string): Session | undefined };
  };
  if (route !== "none") {
    session.openclawSessionKey = route === "direct" ? "direct:acp:grok:fixture" : "agent:grok:acp:fixture";
    session.harnessId = "grok";
    session.harnessState = "running";
    internal.repos.updateSession(session);
  }
  vi.spyOn(internal.direct, "spawnAcpSession").mockRejectedValue(new Error("Unexpected native spawn from force-stop fixture"));
  const now = new Date().toISOString();
  const run: Run = { id: "force-run", projectId: project.id, sessionId: session.id, agentId: "grok", prompt: "Fixture", status: "running", openclawRunId: route === "direct" ? undefined : "gw-run", workingDirectory: dir, createdAt: now, updatedAt: now };
  internal.repos.insertRun(run);
  internal.usingMock = false;
  return { engine, internal, session, run };
}

const cancelledEvents = (engine: CapsuleEngine, runId: string) => engine.listRunEvents(runId).filter((event) => event.type === "cancelled").map((event) => event.message);

it("ends a direct agent that ignores Stop, and the pending Stop settles on the same record", async () => {
  const { engine, internal, session, run } = await fixture("direct");
  let confirm!: () => void;
  vi.spyOn(internal.direct, "cancelAcp").mockImplementation(() => new Promise<void>((resolve) => { confirm = resolve; }));
  const close = vi.spyOn(internal.direct, "closeAcp").mockResolvedValue();
  const stopping = engine.stopRun(run.id);
  expect(engine.getRun(run.id)?.completedAt ?? undefined).toBeUndefined();

  await expect(engine.forceStopRun(run.id)).resolves.toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
  expect(close).toHaveBeenCalledWith(session.openclawSessionKey);
  expect(internal.repos.getSession(session.id)?.harnessState).toBe("closed");

  confirm();
  await expect(stopping).resolves.toMatchObject({ status: "cancelled" });
  expect(cancelledEvents(engine, run.id)).toEqual(["Force stopped. Capsule ended the agent's process."]);
});

it("keeps the turn stopped and reports it when the direct agent's process will not exit", async () => {
  const { engine, internal, session, run } = await fixture("direct");
  vi.spyOn(internal.direct, "closeAcp").mockRejectedValue(new Error("The agent process has not exited. It may still be working."));
  await expect(engine.forceStopRun(run.id)).rejects.toThrow("has not exited");
  expect(engine.getRun(run.id)?.status).toBe("cancelled");
  expect(internal.repos.getSession(session.id)?.harnessState).toBe("error");
});

it("closes a Gateway agent's session without waiting on the abort Stop already sent", async () => {
  const { engine, internal, session, run } = await fixture("gateway");
  let aborted!: () => void;
  vi.spyOn(internal.runtime, "cancelRun").mockImplementation(() => new Promise<void>((resolve) => { aborted = resolve; }));
  const close = vi.spyOn(internal.openclaw, "closeAcp").mockResolvedValue();
  const stopping = engine.stopRun(run.id);

  await engine.forceStopRun(run.id);
  expect(close).toHaveBeenCalledWith(session.openclawSessionKey);
  expect(engine.getRun(run.id)?.status).toBe("cancelled");

  aborted();
  await stopping;
  expect(cancelledEvents(engine, run.id)).toEqual(["Force stopped. Capsule closed the agent's session on the Gateway."]);
});

it("only stops waiting when no agent process belongs to Capsule's thread", async () => {
  const { engine, internal, run } = await fixture("none");
  const direct = vi.spyOn(internal.direct, "closeAcp");
  const gateway = vi.spyOn(internal.openclaw, "closeAcp");
  await expect(engine.forceStopRun(run.id)).resolves.toMatchObject({ status: "cancelled" });
  expect(direct).not.toHaveBeenCalled();
  expect(gateway).not.toHaveBeenCalled();
  expect(cancelledEvents(engine, run.id)).toEqual(["Stopped waiting. The Gateway runs this agent, so Capsule can't end it from here."]);
});

it("leaves a turn that already ended as it was", async () => {
  const { engine, internal, run } = await fixture("direct");
  vi.spyOn(internal.direct, "cancelAcp").mockResolvedValue();
  await engine.stopRun(run.id);
  const close = vi.spyOn(internal.direct, "closeAcp");
  await expect(engine.forceStopRun(run.id)).resolves.toMatchObject({ status: "cancelled" });
  expect(close).not.toHaveBeenCalled();
  expect(cancelledEvents(engine, run.id)).toEqual(["Run cancelled"]);
});

it("ends a running direct turn's agent before deleting its thread, and drops the agent's late frames", async () => {
  const { engine, internal, session, run } = await fixture("direct");
  const close = vi.spyOn(internal.direct, "closeAcp").mockResolvedValue();
  await engine.deleteSession(session.id);
  expect(close).toHaveBeenCalledWith("direct:acp:grok:fixture");
  expect(internal.repos.getSession(session.id)).toBeUndefined();
  const late = (engine as unknown as { handleRuntimeEvent(session: Session, run: Run, event: unknown, stop: () => void): Promise<void> }).handleRuntimeEvent;
  const stop = vi.fn();
  await expect(late.call(engine, session, run, { id: "late", runId: run.id, timestamp: new Date().toISOString(), type: "tool", message: "Edit" }, stop)).resolves.toBeUndefined();
  expect(stop).toHaveBeenCalled();
});

it("aborts and closes a running Gateway turn before deleting its thread", async () => {
  const { engine, internal, session } = await fixture("gateway");
  const abort = vi.spyOn(internal.runtime, "cancelRun").mockResolvedValue();
  const close = vi.spyOn(internal.openclaw, "closeAcp").mockResolvedValue();
  await engine.deleteSession(session.id);
  expect(abort).toHaveBeenCalledWith("gw-run");
  expect(close).toHaveBeenCalledWith("agent:grok:acp:fixture");
  expect(internal.repos.getSession(session.id)).toBeUndefined();
});

it("saves a snapshot of the folder when a turn is stopped", async () => {
  const { engine, internal, run } = await fixture("direct");
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const cwd = run.workingDirectory!;
  execFileSync("git", ["init", "-q"], { cwd });
  writeFileSync(path.join(cwd, "work.txt"), "half done\n");
  vi.spyOn(internal.direct, "cancelAcp").mockResolvedValue();
  await engine.stopRun(run.id);
  await vi.waitFor(() => expect(engine.getRun(run.id)?.checkpointRef).toMatch(/^refs\/capsule\/checkpoints\//), { timeout: 10_000 });
});

it("refuses to restore files past a turn that has no saved snapshot", async () => {
  const { engine, internal, session } = await fixture("none");
  const repos = internal.repos as unknown as { insertRun(run: Run): void; insertMessage(message: unknown): void };
  const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const turns: Array<[string, Partial<Run>]> = [["saved", { status: "completed", checkpointRef: "refs/capsule/checkpoints/x/turn/0/saved" }], ["stopped", { status: "cancelled" }], ["edited", { status: "completed" }]];
  turns.forEach(([id, fields], index) => {
    repos.insertRun({ id, projectId: session.projectId, sessionId: session.id, agentId: "grok", prompt: id, createdAt: at(index * 10), updatedAt: at(index * 10), completedAt: at(index * 10 + 5), ...fields } as Run);
    repos.insertMessage({ id: `msg-${id}`, sessionId: session.id, runId: id, role: "user", content: id, createdAt: at(index * 10 + 1) });
  });
  engine.repos.updateRun({ ...engine.getRun("force-run")!, status: "cancelled", completedAt: at(1) });
  const result = await engine.rewindSession(session.id, "msg-edited", { restoreFiles: true });
  expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/turn before this one has no saved snapshot/) });
  expect(engine.listMessages(session.id).map((message) => message.id)).toContain("msg-edited");
});

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

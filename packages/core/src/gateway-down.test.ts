import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Run, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.restoreAllMocks(); });

async function gatewayDown(thread: Partial<Session> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-gateway-down-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanup.push(async () => { await engine.stop(); rmSync(dir, { recursive: true, force: true }); });
  const project = engine.createProject({ name: "Gateway fixture", workingDirectory: dir });
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  const internal = engine as unknown as {
    usingMock: boolean; runtime: unknown; openclaw: { connected: boolean };
    repos: { updateSession(session: Session): void };
  };
  Object.assign(session, thread);
  internal.repos.updateSession(session);
  // The real adapter, never connected: every Gateway request throws.
  internal.usingMock = false;
  internal.runtime = internal.openclaw;
  expect(internal.openclaw.connected).toBe(false);
  return { engine, session };
}

const threads: Array<[string, Partial<Session>]> = [
  ["a plain Gateway thread", {}],
  ["a live Gateway harness thread", { harnessId: "claude", harnessState: "running", openclawSessionKey: "agent:claude:acp:fixture" }],
];

it.each(threads)("settles a send that never reached the Gateway on %s", async (_name, thread) => {
  const { engine, session } = await gatewayDown(thread);
  await expect(engine.sendMessage({ sessionId: session.id, content: "Hello", mode: "chat" })).rejects.toThrow(/not connected/);
  const [run] = engine.listRuns(session.id);
  expect(run).toMatchObject({ status: "failed", error: expect.stringMatching(/not connected/), completedAt: expect.any(String) });
});

it("stops a turn that never reached the Gateway without asking the Gateway", async () => {
  const { engine, session } = await gatewayDown();
  const internal = engine as unknown as { repos: { insertRun(run: Run): void } };
  const now = new Date().toISOString();
  // What an earlier build left behind: recorded, never dispatched, no Gateway run id.
  internal.repos.insertRun({ id: "stranded-run", projectId: session.projectId, sessionId: session.id, agentId: "main", prompt: "Hello", status: "running", createdAt: now, updatedAt: now });
  await expect(engine.stopRun("stranded-run")).resolves.toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
  expect(engine.getRun("stranded-run")?.status).toBe("cancelled");
});

it("keeps a turn stopped while the Gateway was still accepting it, and aborts it there", async () => {
  const { engine, session } = await gatewayDown();
  const gateway = (engine as unknown as { openclaw: {
    ensureOperatorSession(): Promise<string>; sendMessage(): Promise<Run>; cancelRun(id: string): Promise<void>; subscribeToRun(): () => void;
  } }).openclaw;
  vi.spyOn(gateway, "ensureOperatorSession").mockResolvedValue("agent:main:fixture");
  let accept!: (run: Run) => void;
  vi.spyOn(gateway, "sendMessage").mockImplementation(() => new Promise((resolve) => { accept = resolve; }));
  const cancel = vi.spyOn(gateway, "cancelRun").mockResolvedValue();
  vi.spyOn(gateway, "subscribeToRun").mockReturnValue(() => undefined);
  const sending = engine.sendMessage({ sessionId: session.id, content: "Hello", mode: "chat" });
  await vi.waitFor(() => expect(gateway.sendMessage).toHaveBeenCalled());
  const [run] = engine.listRuns(session.id);
  await expect(engine.stopRun(run!.id)).resolves.toMatchObject({ status: "cancelled" });
  const now = new Date().toISOString();
  accept({ id: "gateway-run", openclawRunId: "oc-1", sessionId: "agent:main:fixture", projectId: "unknown", agentId: "main", prompt: "Hello", status: "running", createdAt: now, updatedAt: now });
  await sending;
  expect(engine.getRun(run!.id)?.status).toBe("cancelled");
  expect(cancel).toHaveBeenCalledWith("gateway-run");
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ApprovalRequest, Run, RunEvent, RuntimeStatus, Session } from "@capsule/shared";
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
  await expect(engine.sendMessage({ sessionId: session.id, content: "Hello", mode: "chat" })).rejects.toThrow(/not connected/i);
  const [run] = engine.listRuns(session.id);
  expect(run).toMatchObject({ status: "failed", error: expect.stringMatching(/not connected/i), completedAt: expect.any(String) });
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

/** A Gateway turn whose runtime events the test delivers by hand. */
async function gatewayTurn() {
  const { engine, session } = await gatewayDown();
  const gateway = (engine as unknown as { openclaw: {
    ensureOperatorSession(): Promise<string>; sendMessage(): Promise<Run>; subscribeToRun(id: string, handler: (event: RunEvent) => void): () => void;
    cancelRun(id: string): Promise<void>; resolveApproval(id: string, decision: string): Promise<void>; getStatus(): Promise<RuntimeStatus>;
  } }).openclaw;
  vi.spyOn(gateway, "ensureOperatorSession").mockResolvedValue("agent:main:fixture");
  const now = new Date().toISOString();
  vi.spyOn(gateway, "sendMessage").mockResolvedValue({ id: "gateway-run", openclawRunId: "oc-1", sessionId: "agent:main:fixture", projectId: "unknown", agentId: "main", prompt: "Hello", status: "running", createdAt: now, updatedAt: now });
  let feed!: (event: RunEvent) => void;
  vi.spyOn(gateway, "subscribeToRun").mockImplementation((_id, handler) => { feed = handler; return () => undefined; });
  const approvals: ApprovalRequest[] = [];
  engine.events.on("approval", (approval: ApprovalRequest) => approvals.push({ ...approval }));
  const { run } = await engine.sendMessage({ sessionId: session.id, content: "Hello", mode: "chat" });
  const event = (type: string, data?: Record<string, unknown>): RunEvent => ({ id: `evt-${type}-${Math.random()}`, runId: "gateway-run", timestamp: new Date().toISOString(), type, message: type, ...(data ? { data } : {}) });
  const ask = async () => {
    feed(event("approval.requested", { approval: { id: "gw-approval", runId: "oc-1", agentId: "main", agentName: "main", action: "Run tests", target: "pnpm test", reason: "", status: "pending", createdAt: new Date().toISOString() } }));
    await vi.waitFor(() => expect(engine.getRun(run.id)?.status).toBe("approval_required"));
  };
  return { engine, session, gateway, run, feed, event, ask, approvals };
}

it("settles a Gateway approval when its turn finishes, so the card goes away", async () => {
  const { engine, run, feed, event, ask, approvals } = await gatewayTurn();
  await ask();
  expect(engine.listApprovals("pending").map((item) => [item.id, item.runId])).toEqual([["gw-approval", run.id]]);
  feed(event("lifecycle", { status: "completed" }));
  await vi.waitFor(() => expect(engine.getRun(run.id)?.status).toBe("completed"));
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(approvals.at(-1)).toMatchObject({ id: "gw-approval", status: "cancelled" });
});

it("stops a Gateway turn locally when the Gateway is unreachable, and admits the next message", async () => {
  const { engine, session, run, ask, approvals } = await gatewayTurn();
  await ask();
  // The real adapter, never connected: cancelRun throws and getStatus says disconnected.
  await expect(engine.stopRun(run.id)).resolves.toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(approvals.at(-1)).toMatchObject({ id: "gw-approval", status: "cancelled" });
  expect(engine.listRunEvents(run.id).find((item) => item.type === "cancelled")?.message).toMatch(/couldn't be reached/);
  await expect(engine.sendMessage({ sessionId: session.id, content: "Again", mode: "chat" })).resolves.toMatchObject({ run: { status: "running" } });
});

it("keeps a Gateway turn running when a connected Gateway refuses to stop it", async () => {
  const { engine, gateway, run } = await gatewayTurn();
  vi.spyOn(gateway, "cancelRun").mockRejectedValue(new Error("abort refused"));
  vi.spyOn(gateway, "getStatus").mockResolvedValue({ state: "connected" } as RuntimeStatus);
  await expect(engine.stopRun(run.id)).rejects.toThrow("abort refused");
  expect(engine.getRun(run.id)?.completedAt ?? undefined).toBeUndefined();
});

it("puts a Gateway approval back when the Gateway does not take the decision", async () => {
  const { engine, gateway, ask, approvals } = await gatewayTurn();
  await ask();
  const resolve = vi.spyOn(gateway, "resolveApproval").mockRejectedValueOnce(new Error("socket closed"));
  await expect(engine.resolveApproval("gw-approval", "approved_once")).rejects.toThrow("The Gateway didn't take that answer. Try again, or stop the turn.");
  expect(engine.listApprovals("pending").map((item) => item.id)).toEqual(["gw-approval"]);
  expect(approvals.at(-1)).toMatchObject({ id: "gw-approval", status: "pending" });
  resolve.mockResolvedValueOnce();
  await engine.resolveApproval("gw-approval", "approved_once");
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(approvals.at(-1)).toMatchObject({ id: "gw-approval", status: "approved_once" });
  await expect(engine.resolveApproval("gw-approval", "denied")).rejects.toThrow("no longer waiting");
});

it("tells the window when the Gateway socket drops", async () => {
  const { engine } = await gatewayDown();
  const internal = engine as unknown as { bindAcpReplies(): void; openclaw: { onConnectionChange(handler: (state: string) => void): () => void } };
  let announce!: (state: string) => void;
  vi.spyOn(internal.openclaw, "onConnectionChange").mockImplementation((handler) => { announce = handler; return () => undefined; });
  internal.bindAcpReplies();
  const seen: RuntimeStatus[] = [];
  engine.events.on("connection", (status: RuntimeStatus) => seen.push(status));
  announce("disconnected");
  await vi.waitFor(() => expect(seen).toMatchObject([{ state: "disconnected" }]));
});

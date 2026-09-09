import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DirectAcpHost } from "@capsule/acp";
import type { Run, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.restoreAllMocks(); });

async function fixture(activeRun = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-boundaries-"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanup.push(async () => { await engine.stop(); rmSync(dir, { recursive: true, force: true }); });
  const project = engine.createProject({ name: "Boundary fixture", workingDirectory: dir });
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  const internal = engine as unknown as {
    usingMock: boolean; direct: DirectAcpHost;
    runtime: { cancelRun: (id: string) => Promise<void> };
    repos: { insertRun(run: Run): void; updateSession(session: Session): void };
    bindAcpReplies(): void;
    ensureHarnessSession(session: Session, harnessId: string, admittingRunId?: string): Promise<Session>;
  };
  session.openclawSessionKey = "direct:acp:grok:fixture";
  session.harnessId = "grok";
  session.harnessState = "running";
  internal.repos.updateSession(session);
  // A unit fixture must never launch the developer's installed coding CLI.
  vi.spyOn(internal.direct, "spawnAcpSession").mockRejectedValue(new Error("Unexpected native spawn from boundary fixture"));
  vi.spyOn(internal.direct, "isRunning").mockImplementation((key) => key === session.openclawSessionKey);
  const now = new Date().toISOString();
  const run: Run = { id: "boundary-run", projectId: project.id, sessionId: session.id, agentId: "grok", prompt: "Fixture", status: "running", workingDirectory: dir, createdAt: now, updatedAt: now };
  if (activeRun) internal.repos.insertRun(run);
  internal.usingMock = false;
  return { engine, internal, project, session, run, dir };
}

it.each([
  { stopReason: "end_turn", status: "completed" },
  { stopReason: "refusal", status: "failed" },
  { stopReason: "max_tokens", status: "failed" },
])("settles direct $stopReason turns and admits the next message", async ({ stopReason, status }) => {
  const { engine, internal, session } = await fixture(false);
  vi.spyOn(internal.direct, "send").mockResolvedValue({ stopReason });

  const first = await engine.sendMessage({ sessionId: session.id, content: "First turn", mode: "chat" });
  await vi.waitFor(() => expect(engine.getRun(first.run.id)).toMatchObject({ status, completedAt: expect.any(String) }));
  expect(engine.listSessions().find((item) => item.id === session.id)?.harnessState).toBe("waiting");

  const second = await engine.sendMessage({ sessionId: session.id, content: "Second turn", mode: "chat" });
  await vi.waitFor(() => expect(engine.getRun(second.run.id)?.status).toBe(status));
  expect(internal.direct.spawnAcpSession).not.toHaveBeenCalled();
});

it("settles a rejected direct send as failed", async () => {
  const { engine, internal, session } = await fixture(false);
  vi.spyOn(internal.direct, "send").mockRejectedValue(new Error("Agent disconnected"));
  const { run } = await engine.sendMessage({ sessionId: session.id, content: "Start", mode: "chat" });
  await vi.waitFor(() => expect(engine.getRun(run.id)).toMatchObject({
    status: "failed", error: "Agent disconnected", completedAt: expect.any(String),
  }));
  expect(internal.direct.spawnAcpSession).not.toHaveBeenCalled();
});

it.each(["resolves", "rejects"])("keeps Stop final when delayed startup %s", async (outcome) => {
  const { engine, internal, session } = await fixture(false);
  let finish!: () => void;
  vi.spyOn(internal, "ensureHarnessSession").mockImplementation(() => new Promise((resolve, reject) => {
    finish = () => outcome === "resolves" ? resolve(session) : reject(new Error("Late startup failure"));
  }));
  const send = vi.spyOn(internal.direct, "send");
  const sending = engine.sendMessage({ sessionId: session.id, content: "Do not send after Stop", mode: "chat" });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const pending = engine.listRuns(session.id)[0]!;
  await engine.stopRun(pending.id);
  finish();
  const result = await sending;
  expect(result.run.status).toBe("cancelled");
  expect(engine.getRun(pending.id)).toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
  expect(send).not.toHaveBeenCalled();
});

it("can stop an unsent first turn before a native session key exists", async () => {
  const { engine, internal, session } = await fixture(false);
  session.openclawSessionKey = undefined;
  session.harnessState = "closed";
  internal.repos.updateSession(session);
  let finish!: () => void;
  vi.spyOn(internal, "ensureHarnessSession").mockImplementation(() => new Promise((resolve) => { finish = () => resolve(session); }));
  const cancel = vi.spyOn(internal.runtime, "cancelRun").mockRejectedValue(new Error("No dispatched Gateway run"));
  const send = vi.spyOn(internal.direct, "send");
  const sending = engine.sendMessage({ sessionId: session.id, content: "Cancel startup", mode: "chat" });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const pending = engine.listRuns(session.id)[0]!;
  expect((await engine.stopRun(pending.id)).status).toBe("cancelled");
  finish();
  expect((await sending).run.status).toBe("cancelled");
  expect(cancel).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("preserves the previous agent identity when switching cannot close it", async () => {
  const { engine, internal, session } = await fixture(false);
  vi.spyOn(internal.direct, "closeAcp").mockRejectedValue(new Error("Agent has not exited"));
  await expect(engine.sendMessage({ sessionId: session.id, agentId: "gemini", content: "Switch agent", mode: "chat" })).rejects.toThrow("Agent has not exited");
  expect(internal.direct.spawnAcpSession).not.toHaveBeenCalled();
  expect(engine.listSessions().find((item) => item.id === session.id)).toMatchObject({
    harnessId: "grok", openclawSessionKey: session.openclawSessionKey, harnessState: "error",
  });
  expect(engine.listRuns(session.id)[0]?.status).toBe("failed");
});

it("persists direct permission requests, resolves once, and cancels pending requests on Stop", async () => {
  const { engine, internal, session, run } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  const allow = vi.fn(); const deny = vi.fn(); const cancelPermission = vi.fn();
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Write fixture", allow, deny, cancel: cancelPermission } });
  expect(engine.getRun(run.id)?.status).toBe("approval_required");
  const approval = engine.listApprovals("pending")[0]!;
  await expect(engine.resolveApproval(approval.id, "approved_session")).rejects.toThrow("approval once");
  expect(engine.listApprovals("pending")).toHaveLength(1);
  await engine.resolveApproval(approval.id, "approved_once");
  await expect(engine.resolveApproval(approval.id, "approved_once")).rejects.toThrow("not found");
  expect(allow).toHaveBeenCalledOnce(); expect(deny).not.toHaveBeenCalled();
  expect(engine.getRun(run.id)?.status).toBe("running");
  activity({ type: "tool", sessionKey: session.openclawSessionKey!, tool: { title: "Write fixture", status: "completed" } });
  expect(engine.listRunEvents(run.id).some((event) => event.type === "tool" && event.message === "Write fixture")).toBe(true);
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Second request", allow, deny, cancel: cancelPermission } });
  const cancel = vi.spyOn(internal.direct, "cancelAcp").mockResolvedValue();
  const gateway = vi.spyOn(internal.runtime, "cancelRun").mockResolvedValue();
  await engine.stopRun(run.id);
  expect(cancel).toHaveBeenCalledWith(session.openclawSessionKey);
  expect(gateway).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  expect(cancelPermission).toHaveBeenCalledOnce();
  expect(engine.listApprovals("cancelled")).toHaveLength(1);
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(engine.getRun(run.id)?.status).toBe("cancelled");
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Late request", allow, deny, cancel: cancelPermission } });
  expect(cancelPermission).toHaveBeenCalledTimes(2);
  expect(deny).not.toHaveBeenCalled();
  expect(engine.listApprovals("pending")).toEqual([]);
});

it("does not persist unsupported direct changes or accept overlapping turns", async () => {
  const { engine, session, project, run } = await fixture();
  await expect(engine.setHarnessOption({ sessionId: session.id, key: "model", value: "not-supported" })).rejects.toThrow();
  expect(engine.listSessions(project.id).find((item) => item.id === session.id)?.modelOverride).toBeUndefined();
  await expect(engine.setHarnessOption({ sessionId: session.id, key: "cwd", value: "/another-folder" })).rejects.toThrow("working-directory");
  expect(engine.getProject(project.id)?.workingDirectory).toBe(run.workingDirectory);
  await expect(engine.sendMessage({ sessionId: session.id, content: "overlap", mode: "chat" })).rejects.toThrow("active turn");
  expect(engine.listRuns(session.id)).toHaveLength(1);
});

it.each(["stop", "close"])("clears approval decisions before %s confirmation, including a timeout", async (action) => {
  const { engine, internal, session, run } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  const allow = vi.fn(), deny = vi.fn(), cancel = vi.fn();
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Pending write", allow, deny, cancel } });
  const approval = engine.listApprovals("pending")[0]!;
  let reject!: (error: Error) => void;
  vi.spyOn(internal.direct, action === "stop" ? "cancelAcp" : "closeAcp")
    .mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const ending = action === "stop" ? engine.stopRun(run.id) : engine.closeHarness(session.id);
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(engine.listApprovals("cancelled").map((item) => item.id)).toEqual([approval.id]);
  expect(cancel).toHaveBeenCalledOnce();
  await expect(engine.resolveApproval(approval.id, "approved_once")).rejects.toThrow("not found");
  expect(allow).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  reject(new Error("Not confirmed"));
  await expect(ending).rejects.toThrow("Not confirmed");
  expect(engine.getRun(run.id)).toMatchObject({ status: "approval_required" });
  expect(engine.getRun(run.id)?.completedAt ?? undefined).toBeUndefined();
});

it("persists cancelled approvals before closing the engine database", async () => {
  const { engine, internal, session } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  const cancel = vi.fn(), deny = vi.fn();
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Pending write", allow: vi.fn(), deny, cancel } });
  const approval = engine.listApprovals("pending")[0]!;
  const persisted: string[] = [];
  engine.events.on("approval", () => { persisted.push(...engine.listApprovals("cancelled").map((item) => item.id)); });
  await engine.stop();
  expect(persisted).toEqual([approval.id]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(deny).not.toHaveBeenCalled();
});

it("keeps unsupported one-time approvals pending and retains the proposed operation", async () => {
  const { engine, internal, session } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  const allow = vi.fn();
  const deny = vi.fn();
  const details = { locations: ["src/fixture.ts"], preview: "command: inspect", truncated: false, canApproveOnce: false };
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Inspect", details, canApproveOnce: false, allow, deny, cancel: vi.fn() } });
  const approval = engine.listApprovals("pending")[0]!;
  expect(approval.details).toEqual(details);
  await expect(engine.resolveApproval(approval.id, "approved_once")).rejects.toThrow();
  expect(engine.listApprovals("pending")).toHaveLength(1);
  expect(allow).not.toHaveBeenCalled();
  await engine.resolveApproval(approval.id, "denied");
  expect(deny).toHaveBeenCalledOnce();
});

it("records context snapshots and turn usage separately from transcript accounting", async () => {
  const { engine, internal, session, run } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  activity({ type: "usage", sessionKey: session.openclawSessionKey!, usage: { context: { source: "agent", used: 10, size: 100 } } });
  activity({ type: "usage", sessionKey: session.openclawSessionKey!, usage: { turn: { source: "agent", inputTokens: 5 } } });
  expect(engine.listRunEvents(run.id).map((event) => event.type)).toEqual(expect.arrayContaining(["usage.context", "usage.turn"]));
});

it("uses one local-command policy and excludes restore while a shell owns the folder", async () => {
  const { engine, project, dir } = await fixture();
  const release = engine.beginLocalCommand(dir);
  release(); release();
  await engine.updateSettings({ sandbox: "strict" });
  expect(() => engine.beginLocalCommand(dir)).toThrow("Strict");
  expect(() => engine.assertLocalCommandsAllowed()).toThrow("Strict");
  await expect(engine.execInProject(project.id, "echo must-not-run")).rejects.toThrow("Strict");
  await expect(engine.openTerminal(project.id)).rejects.toThrow("Strict");
});

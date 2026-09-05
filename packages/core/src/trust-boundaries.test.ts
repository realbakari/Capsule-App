import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DirectAcpHost } from "@capsule/acp";
import type { Run, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.restoreAllMocks(); });

async function fixture() {
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
  };
  session.openclawSessionKey = "direct:acp:grok:fixture";
  session.harnessId = "grok";
  session.harnessState = "running";
  internal.repos.updateSession(session);
  const now = new Date().toISOString();
  const run: Run = { id: "boundary-run", projectId: project.id, sessionId: session.id, agentId: "grok", prompt: "Fixture", status: "running", workingDirectory: dir, createdAt: now, updatedAt: now };
  internal.repos.insertRun(run);
  internal.usingMock = false;
  return { engine, internal, project, session, run, dir };
}

it("persists direct permission requests, resolves once, denies pending requests on Stop", async () => {
  const { engine, internal, session, run } = await fixture();
  let activity!: Parameters<DirectAcpHost["onActivity"]>[0];
  vi.spyOn(internal.direct, "onActivity").mockImplementation((handler) => { activity = handler; return () => {}; });
  internal.bindAcpReplies();
  const allow = vi.fn(); const deny = vi.fn();
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Write fixture", allow, deny } });
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
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Second request", allow, deny } });
  const cancel = vi.spyOn(internal.direct, "cancelAcp").mockResolvedValue();
  const gateway = vi.spyOn(internal.runtime, "cancelRun").mockResolvedValue();
  await engine.stopRun(run.id);
  expect(cancel).toHaveBeenCalledWith(session.openclawSessionKey);
  expect(gateway).not.toHaveBeenCalled();
  expect(deny).toHaveBeenCalledOnce();
  expect(engine.listApprovals("pending")).toEqual([]);
  expect(engine.getRun(run.id)?.status).toBe("cancelled");
  activity({ type: "permission", sessionKey: session.openclawSessionKey!, request: { title: "Late request", allow, deny } });
  expect(deny).toHaveBeenCalledTimes(2);
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

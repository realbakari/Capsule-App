import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Run } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it.each(["direct:acp:grok:interrupted", "agent:claude:acp:interrupted"])("recovers interrupted approvals for %s and admits work after reopening", async (key) => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-startup-recovery-"));
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    const project = engine.createProject({ name: "Recovery", workingDirectory: directory });
    const session = await engine.createSession({ projectId: project.id, mode: "chat" });
    engine.repos.updateSession({ ...session, harnessState: "running", openclawSessionKey: key });
    const at = new Date().toISOString();
    // Persisted requests have no callbacks after a process exits or crashes.
    const run: Run = { id: "interrupted", projectId: project.id, sessionId: session.id, agentId: "general", prompt: "Work", status: "approval_required", createdAt: at, updatedAt: at };
    engine.repos.insertRun(run);
    engine.repos.insertApproval({ id: "pending", runId: run.id, agentId: run.agentId, agentName: "Fixture", action: "write", target: "fixture.txt", reason: "Permission needed", status: "pending", createdAt: at });
    engine.repos.insertRun({ ...run, id: "finished", status: "completed", completedAt: at });
    engine.repos.insertApproval({ id: "orphan", runId: "finished", agentId: run.agentId, agentName: "Fixture", action: "write", target: "other.txt", reason: "Orphaned callback", status: "pending", createdAt: at });
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    expect(engine.getRun(run.id)).toMatchObject({ status: "cancelled", completedAt: expect.any(String) });
    expect(engine.getRun("finished")?.status).toBe("completed");
    expect(engine.listApprovals("pending")).toEqual([]);
    expect(engine.listApprovals("cancelled")).toHaveLength(2);
    const recovered = engine.listSessions().find((item) => item.id === session.id)!;
    expect(recovered.harnessState).toBe("closed");
    expect(recovered.openclawSessionKey).toBeFalsy();
    await expect(engine.resolveApproval("pending", "approved_once")).rejects.toThrow("not found");
    await expect(engine.prepareForUpdate()).resolves.toBeUndefined();
    const next = await engine.sendMessage({ sessionId: session.id, content: "Continue", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"), { timeout: 5000 });
  } finally {
    await engine.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

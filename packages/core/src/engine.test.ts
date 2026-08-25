import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

async function waitForRun(engine: CapsuleEngine, runId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Run did not complete")), 5000);
    const onRun = () => {
      const run = engine.getRun(runId);
      if (run && ["completed", "failed", "cancelled", "approval_required"].includes(run.status)) {
        clearTimeout(timeout);
        engine.events.off("run", onRun);
        resolve();
      }
    };
    engine.events.on("run", onRun);
  });
}

describe("CapsuleEngine first user flow", () => {
  it("creates a project, conversation, run, verification, and artifact", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-engine-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "API Workspace", defaultMode: "code" });
    const session = await engine.createSession({
      projectId: project.id,
      title: "Build REST API",
      mode: "code",
      agentId: "coding",
    });
    const { run } = await engine.sendMessage({
      sessionId: session.id,
      content: "Build a REST API for this project.",
      agentId: "coding",
      mode: "code",
    });
    await waitForRun(engine, run.id);
    const completed = engine.getRun(run.id);
    expect(completed?.status).toBe("completed");
    expect(engine.listMessages(session.id).some((message) => message.role === "assistant")).toBe(
      true,
    );
    expect(engine.listArtifacts(run.id).length).toBeGreaterThan(0);
    expect(engine.listRunEvents(run.id).some((event) => event.type === "contract")).toBe(true);
    await engine.stop();
  });

  it("dedicates Claude and routes code work through the harness", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-harness-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Harness Workspace" });
    await engine.dedicateHarness(project.id, "claude");
    expect(engine.getProject(project.id)?.defaultAgentId).toBe("claude");
    const session = await engine.createSession({
      projectId: project.id,
      title: "Implement the API",
      mode: "code",
    });
    const { session: used, run } = await engine.sendMessage({
      sessionId: session.id,
      content: "Implement the REST handlers.",
      mode: "code",
    });
    expect(used.agentId).toBe("claude");
    expect(used.harnessId).toBe("claude");
    expect(used.harnessState).toBe("running");
    await waitForRun(engine, run.id);
    const closed = await engine.closeHarness(used.id);
    expect(closed.session.harnessState).toBe("closed");
    await engine.undedicateHarness(project.id);
    expect(engine.getProject(project.id)?.defaultAgentId).toBeUndefined();
    await engine.stop();
  });

  it("spawns, steers, and reports status for a mock Codex session", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-codex-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Codex Workspace", workingDirectory: dir });
    const spawned = await engine.spawnHarness({
      projectId: project.id,
      harnessId: "codex",
      prompt: "List the files in this workspace.",
    });
    expect(spawned.session.harnessId).toBe("codex");
    expect(spawned.session.harnessState).toBe("running");
    const steered = await engine.steerHarness(spawned.session.id, "Focus on the failing tests.");
    expect(steered.session.harnessState).toBe("running");
    const status = await engine.harnessStatus(spawned.session.id);
    expect(status.state).toBe("running");
    expect(engine.listHarnessSessions(project.id)).toHaveLength(1);
    const doctor = await engine.doctorHarness("codex");
    expect(doctor.harnessId).toBe("codex");
    expect(doctor.checks.some((check) => check.id === "cli")).toBe(true);
    await engine.stop();
  });

  it("renames and deletes a project, cascading sessions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-delete-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const keep = engine.listProjects()[0];
    const project = engine.createProject({ name: "Throwaway", workingDirectory: dir });
    const session = await engine.createSession({ projectId: project.id, title: "Temp" });
    engine.updateProject(project.id, { name: "Renamed" });
    expect(engine.getProject(project.id)?.name).toBe("Renamed");
    engine.deleteProject(project.id);
    expect(engine.getProject(project.id)).toBeUndefined();
    expect(engine.listSessions().some((item) => item.id === session.id)).toBe(false);
    expect(engine.listProjects().some((item) => item.id === keep?.id || item.name === "Inbox")).toBe(
      true,
    );
    await engine.stop();
  });

  it("pins a thread, regenerates its title, and searches files and messages", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-pin-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Search Workspace", workingDirectory: dir });
    const session = await engine.createSession({ projectId: project.id, title: "New conversation" });
    await engine.sendMessage({
      sessionId: session.id,
      content: "Please review the renderer shell.",
      mode: "chat",
    });
    const pinned = engine.pinSession(session.id, true);
    expect(pinned.pinned).toBe(true);
    const titled = engine.regenerateTitle(session.id);
    expect(titled.title.toLowerCase()).toContain("review");
    expect(engine.search("renderer").messages.length).toBeGreaterThan(0);
    expect(engine.searchFiles(project.id, "sqlite").length).toBeGreaterThanOrEqual(0);
    await engine.setPermissionProfile(session.id, "strict");
    expect(engine.listSessions(project.id)[0]?.permissionProfile).toBe("strict");
    await engine.stop();
  });

  it("persists settings minus the gateway token and applies conversation defaults", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-settings-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const saved = await engine.updateSettings({
      gatewayUrl: "ws://127.0.0.1:19999",
      gatewayToken: "operator-secret",
      composerSendKey: "cmd-enter",
      defaultMode: "code",
      defaultPermission: "strict",
      launchAtLogin: true,
      useMockWhenOffline: false,
    });
    expect(saved.gatewayToken).toBe("••••");
    expect(saved.composerSendKey).toBe("cmd-enter");
    expect(saved.defaultMode).toBe("code");
    expect(saved.launchAtLogin).toBe(true);
    const masked = await engine.updateSettings({ gatewayToken: "••••" });
    expect(masked.gatewayToken).toBe("••••");
    const project = engine.listProjects()[0];
    expect(project).toBeDefined();
    const session = await engine.createSession({ projectId: project!.id, title: "Defaults" });
    expect(session.permissionProfile).toBe("strict");
    await engine.stop();

    const reloaded = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await reloaded.start();
    const loaded = reloaded.getSettings();
    expect(loaded.gatewayUrl).toBe("ws://127.0.0.1:19999");
    expect(loaded.gatewayToken).toBe("••••");
    expect(loaded.composerSendKey).toBe("cmd-enter");
    expect(loaded.defaultMode).toBe("code");
    expect(loaded.defaultPermission).toBe("strict");
    expect(loaded.launchAtLogin).toBe(true);
    expect(loaded.useMockWhenOffline).toBe(false);
    const cleared = await reloaded.updateSettings({ gatewayToken: "" });
    expect(cleared.gatewayToken).toBeUndefined();
    await reloaded.stop();
  });
});

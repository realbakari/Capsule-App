import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  it("creates a project, conversation, run, and contract event", async () => {
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
    expect(engine.listArtifacts(run.id)).toEqual([]);
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
      agentId: "general",
    });
    const { session: used, run } = await engine.sendMessage({
      sessionId: session.id,
      content: "Implement the REST handlers.",
      agentId: "general",
      mode: "code",
    });
    expect(used.agentId).toBe("claude");
    expect(used.harnessId).toBe("claude");
    expect(used.harnessState).toBe("running");
    await waitForRun(engine, run.id);
    const closed = await engine.closeHarness(used.id);
    expect(closed.session.harnessState).toBe("closed");
    expect(engine.listHarnessSessions(project.id)).toHaveLength(0);
    await engine.undedicateHarness(project.id);
    expect(engine.getProject(project.id)?.defaultAgentId).toBeUndefined();
    await engine.stop();
  });

  it("starts the new agent's session when a live thread switches harness", async () => {
    /*
     * The prompt used to go to whichever session was already running while the
     * thread relabelled itself as the agent you picked — the composer said
     * Codex and Claude answered.
     */
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-switch-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Switch Workspace" });
    const session = await engine.createSession({
      projectId: project.id,
      title: "Port the parser",
      mode: "code",
      agentId: "claude",
    });
    const first = await engine.sendMessage({
      sessionId: session.id,
      content: "Start on the parser.",
      agentId: "claude",
      mode: "code",
    });
    expect(first.session.harnessId).toBe("claude");
    await waitForRun(engine, first.run.id);
    const firstKey = first.session.openclawSessionKey;

    const second = await engine.sendMessage({
      sessionId: session.id,
      content: "Keep going.",
      agentId: "codex",
      mode: "code",
    });
    expect(second.session.harnessId).toBe("codex");
    expect(second.session.harnessState).toBe("running");
    expect(second.session.openclawSessionKey).not.toBe(firstKey);
    await waitForRun(engine, second.run.id);
    await engine.stop();
  });

  it("takes the project's workspace default and runs its setup actions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-project-defaults-"));
    const repository = path.join(dir, "repository");
    mkdirSync(repository);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repository, encoding: "utf8" });
    git("init");
    git("config", "user.email", "capsule@example.test");
    git("config", "user.name", "Capsule Test");
    writeFileSync(path.join(repository, "README.md"), "base\n");
    git("add", "README.md");
    git("commit", "-m", "initial");

    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Defaults", workingDirectory: repository });
    // The app-wide default is "local"; the project asks for isolation.
    engine.updateProject(project.id, {
      defaultWorkspaceMode: "worktree",
      actions: [
        { id: "setup", name: "Setup", command: "pwd", runOnWorktreeCreate: true },
        { id: "other", name: "Other", command: "pwd" },
      ],
    });
    expect(engine.getProject(project.id)?.defaultWorkspaceMode).toBe("worktree");

    const session = await engine.createSession({ projectId: project.id, title: "Isolated" });
    expect(session.workspaceMode).toBe("worktree");
    expect(session.workingDirectory).not.toBe(repository);

    const runs = engine.listProjectActionRuns(project.id, session.id);
    expect(runs.map((run) => run.actionId)).toEqual(["setup"]);

    // Clearing the override returns the project to the app-wide default.
    engine.updateProject(project.id, { defaultWorkspaceMode: null });
    const plain = await engine.createSession({ projectId: project.id, title: "Shared" });
    expect(plain.workspaceMode).toBe("local");
    await engine.stop();
  });

  it("does not offer bootstrap mock agents after a live Gateway connects", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-live-agents-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    engine.repos.upsertAgent({
      id: "main",
      name: "Main",
      description: "Gateway default",
      runtime: "openclaw",
      model: "default",
      skills: [],
      tools: [],
      permissions: {},
      status: "idle",
      kind: "agent",
      recentRunIds: [],
    });
    (engine as unknown as { usingMock: boolean }).usingMock = false;

    const agents = await engine.listAgents();

    expect(agents.map((agent) => agent.id)).toContain("main");
    expect(agents.map((agent) => agent.id)).not.toContain("general");
    expect(agents.map((agent) => agent.id)).not.toContain("coding");
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
    expect(spawned.session.permissionProfile).toBe("default");
    const steered = await engine.steerHarness(spawned.session.id, "Focus on the failing tests.");
    expect(steered.session.harnessState).toBe("running");
    const status = await engine.harnessStatus(spawned.session.id);
    expect(status.state).toBe("running");
    expect(engine.listHarnessSessions(project.id)).toHaveLength(1);
    const updated = await engine.setHarnessOption({
      sessionId: spawned.session.id,
      key: "model",
      value: "gpt-5.6-terra",
    });
    expect(updated.session.modelOverride).toBe("gpt-5.6-terra");
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
    const extra = path.join(dir, "docs");
    mkdirSync(extra);
    writeFileSync(path.join(extra, "notes.md"), "extra folder notes\n");
    engine.updateProject(project.id, { extraFolders: [extra] });
    expect(engine.getProject(project.id)?.extraFolders).toEqual([extra]);
    expect(engine.listFiles(project.id, ".", extra).some((entry) => entry.name === "notes.md")).toBe(
      true,
    );
    expect(
      engine.searchFiles(project.id, "notes", extra).some((entry) => entry.name === "notes.md"),
    ).toBe(true);
    expect(() => engine.listFiles(project.id, ".", "/not-attached")).toThrow(/not attached/i);
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
    const second = await engine.createSession({ projectId: project.id, title: "Second pinned task" });
    engine.pinSession(second.id, true);
    engine.reorderPinnedSessions(project.id, [second.id, session.id]);
    expect(engine.listSessions(project.id).filter((item) => item.pinned).map((item) => item.id)).toEqual([
      second.id,
      session.id,
    ]);
    expect(() => engine.reorderPinnedSessions(project.id, [session.id])).toThrow(/stale/i);
    const titled = engine.regenerateTitle(session.id);
    expect(titled.title.toLowerCase()).toContain("review");
    expect(engine.search("renderer").messages.length).toBeGreaterThan(0);
    expect(engine.searchFiles(project.id, "sqlite").length).toBeGreaterThanOrEqual(0);
    await engine.setPermissionProfile(session.id, "strict");
    expect(engine.listSessions(project.id).find((item) => item.id === session.id)?.permissionProfile).toBe(
      "strict",
    );
    await engine.stop();
  });

  it("persists selected file attachments and accepts an attachment-only turn", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-attachments-"));
    const attachmentPath = path.join(dir, "brief.md");
    writeFileSync(attachmentPath, "Review the API boundaries.\n");
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Attachment Workspace", workingDirectory: dir });
    const session = await engine.createSession({ projectId: project.id, title: "New conversation" });

    const validated = engine.validateAttachments([{ name: "brief.md", path: attachmentPath }]);
    const sent = await engine.sendMessage({
      sessionId: session.id,
      content: "",
      mode: "chat",
      attachments: validated,
    });

    expect(sent.userMessage.attachments).toEqual(validated);
    expect(engine.listMessages(session.id)[0]?.attachments).toEqual(validated);
    expect(engine.listSessions(project.id).find((item) => item.id === session.id)?.title).toContain(
      "brief.md",
    );
    expect(() =>
      engine.validateAttachments([{ name: "missing.txt", path: path.join(dir, "missing.txt") }]),
    ).toThrow(/not found/i);
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
    const spawned = await engine.spawnHarness({ projectId: project!.id, harnessId: "codex" });
    expect(spawned.session.permissionProfile).toBe("strict");
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
    // Nothing set a theme, so this is the default: follow the Mac.
    expect(loaded.appearanceTheme).toBe("system");
    expect(loaded.appearanceDark.accent).toBe("#F3F3EE");
    expect(loaded.appearanceLight.background).toBe("#FFFFFF");
    expect(loaded.notifyRunComplete).toBe(true);
    expect(loaded.webAccess).toBe("on");
    expect(loaded.sandbox).toBe("ask");
    const withConfig = await reloaded.updateSettings({
      webAccess: "off",
      sandbox: "strict",
      notifyRunComplete: false,
      branchPrefix: "capsule",
    });
    expect(withConfig.webAccess).toBe("off");
    expect(withConfig.sandbox).toBe("strict");
    expect(withConfig.notifyRunComplete).toBe(false);
    expect(reloaded.repos.listPolicies().find((rule) => rule.id === "net-https")?.decision).toBe(
      "block",
    );
    const cleared = await reloaded.updateSettings({ gatewayToken: "" });
    expect(cleared.gatewayToken).toBeUndefined();
    await reloaded.stop();
  });
});

describe("projectless Inbox folder", () => {
  it("gives Inbox a task folder and each thread its own dated directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-inbox-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const inbox = engine.listProjects().find((project) => project.name === "Inbox");
    expect(inbox?.workingDirectory).toBe(path.join(dir, "tasks"));
    const session = await engine.createSession({
      projectId: inbox!.id,
      title: "Plan a change",
      mode: "chat",
    });
    expect(session.workingDirectory).toContain(`${path.sep}tasks${path.sep}`);
    expect(session.workingDirectory).toContain("plan-a-change");
    const moved = await engine.updateSettings({ projectlessFolder: path.join(dir, "loose") });
    expect(moved.projectlessFolder).toBe(path.join(dir, "loose"));
    expect(engine.getProject(inbox!.id)?.workingDirectory).toBe(path.join(dir, "loose"));
    await engine.stop();
  });
});

describe("project workspace tools", () => {
  it("creates a thread worktree and runs saved actions inside it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-project-tools-"));
    const repository = path.join(dir, "repository");
    mkdirSync(repository);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repository, encoding: "utf8" });
    git("init");
    git("config", "user.email", "capsule@example.test");
    git("config", "user.name", "Capsule Test");
    writeFileSync(path.join(repository, "README.md"), "base\n");
    git("add", "README.md");
    git("commit", "-m", "initial");

    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Tools", workingDirectory: repository });
    engine.updateProject(project.id, {
      actions: [{ id: "where", name: "Where", command: "pwd" }],
    });
    const session = await engine.createSession({
      projectId: project.id,
      title: "Isolated task",
      workspaceMode: "worktree",
    });
    expect(session.workspaceMode).toBe("worktree");
    expect(session.workingDirectory).not.toBe(repository);
    expect(session.worktreeBranch).toMatch(/^capsule\//);
    expect(engine.gitStatus(project.id, session.id).isRepo).toBe(true);

    engine.runProjectAction(project.id, "where", session.id);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const run = engine.listProjectActionRuns(project.id, session.id)[0];
      if (run && run.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const action = engine.listProjectActionRuns(project.id, session.id)[0];
    expect(action?.status).toBe("completed");
    expect(action?.output).toContain(session.workingDirectory);

    const worktree = session.workingDirectory!;
    engine.deleteSession(session.id);
    expect(() => readFileSync(path.join(worktree, "README.md"))).toThrow();
    await engine.stop();
  });
});

describe("failed runs are not contract-verified", () => {
  it("keeps the runtime's own error and emits no verification artifact", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-failrun-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Verify", defaultMode: "chat" });
    const session = await engine.createSession({
      projectId: project.id,
      title: "New conversation",
      mode: "chat",
      agentId: "general",
    });
    const { run } = await engine.sendMessage({
      sessionId: session.id,
      content: "[fail] break the turn",
      agentId: "general",
      mode: "chat",
    });
    await waitForRun(engine, run.id);

    const settled = engine.getRun(run.id);
    expect(settled?.status).toBe("failed");
    // The runtime's own cause must survive rather than being replaced by a
    // generic contract verdict — that is what hid "Authentication required".
    expect(settled?.error).toBeTruthy();
    expect(settled?.error).not.toBe("Verification failed");
    expect(engine.listArtifacts(run.id).some((a) => a.title === "Verification report")).toBe(false);
    await engine.stop();
  });
});

describe("inactive session archive", () => {
  it("archives idle threads past the cutoff and keeps pinned work", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-archive-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Archive", defaultMode: "chat" });
    const idle = await engine.createSession({
      projectId: project.id,
      title: "Old thread",
      mode: "chat",
    });
    const pinned = await engine.createSession({
      projectId: project.id,
      title: "Keep me",
      mode: "chat",
    });
    const kept = engine.pinSession(pinned.id, true);
    const stale = new Date(Date.now() - 2 * 86_400_000).toISOString();
    idle.updatedAt = stale;
    kept.updatedAt = stale;
    engine.repos.updateSession(idle);
    engine.repos.updateSession(kept);
    await engine.updateSettings({ archiveInactiveAfter: "1d" });
    const sessions = engine.listSessions(project.id);
    expect(sessions.find((item) => item.id === idle.id)?.state).toBe("archived");
    expect(sessions.find((item) => item.id === kept.id)?.state).toBe("active");
    await engine.stop();
  });
});

describe("concurrent edits to a project file", () => {
  async function withEngine(fn: (engine: CapsuleEngine, projectId: string, dir: string) => Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-conflict-"));
    const work = path.join(dir, "work");
    mkdirSync(work, { recursive: true });
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
      autoConnect: false,
    });
    await engine.start();
    const project = engine.createProject({ name: "Conflict", workingDirectory: work });
    try {
      await fn(engine, project.id, work);
    } finally {
      await engine.stop();
    }
  }

  it("writes when the file has not changed since it was read", async () => {
    await withEngine(async (engine, projectId, work) => {
      writeFileSync(path.join(work, "notes.md"), "original\n");
      const opened = engine.readFileVersioned(projectId, "notes.md");
      engine.writeFile(projectId, "notes.md", "edited\n", {
        origin: "user",
        expectedRevision: opened.revision,
      });
      expect(readFileSync(path.join(work, "notes.md"), "utf8")).toBe("edited\n");
    });
  });

  it("refuses to clobber a file the agent rewrote while it was open", async () => {
    await withEngine(async (engine, projectId, work) => {
      const file = path.join(work, "notes.md");
      writeFileSync(file, "original\n");
      const opened = engine.readFileVersioned(projectId, "notes.md");
      // The agent writes straight to disk over ACP while the editor is open.
      writeFileSync(file, "written by the agent\n");
      expect(() =>
        engine.writeFile(projectId, "notes.md", "my edit\n", {
          origin: "user",
          expectedRevision: opened.revision,
        }),
      ).toThrow(/FILE_CHANGED_ON_DISK/);
      // The agent's work must survive the refusal.
      expect(readFileSync(file, "utf8")).toBe("written by the agent\n");
    });
  });

  it("still writes when no revision is supplied", async () => {
    await withEngine(async (engine, projectId, work) => {
      writeFileSync(path.join(work, "notes.md"), "original\n");
      engine.writeFile(projectId, "notes.md", "forced\n", { origin: "user" });
      expect(readFileSync(path.join(work, "notes.md"), "utf8")).toBe("forced\n");
    });
  });

  it("creates a new file even though it has no prior revision", async () => {
    await withEngine(async (engine, projectId, work) => {
      engine.writeFile(projectId, "fresh.md", "new\n", {
        origin: "user",
        expectedRevision: "0:0",
      });
      expect(readFileSync(path.join(work, "fresh.md"), "utf8")).toBe("new\n");
    });
  });

  it("reports truncation without letting it corrupt the revision", async () => {
    await withEngine(async (engine, projectId, work) => {
      const long = "x".repeat(50);
      writeFileSync(path.join(work, "big.txt"), long);
      const opened = engine.readFileVersioned(projectId, "big.txt", 10);
      expect(opened.truncated).toBe(true);
      expect(opened.contents).toHaveLength(10);
      // The revision must describe the whole file, or a reload would look
      // like an external change.
      expect(opened.revision).toBe(engine.readFileVersioned(projectId, "big.txt").revision);
    });
  });

  it("previews source as text and images as data URLs", async () => {
    await withEngine(async (engine, projectId, work) => {
      writeFileSync(path.join(work, "app.ts"), "export const n = 1;\n");
      writeFileSync(
        path.join(work, "logo.png"),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      );
      const code = engine.previewFile(projectId, "app.ts");
      expect(code.kind).toBe("text");
      expect(code.language).toBe("ts");
      expect(code.contents).toContain("export const n");
      const image = engine.previewFile(projectId, "logo.png");
      expect(image.kind).toBe("image");
      expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });
});

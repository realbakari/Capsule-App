import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentRuntime } from "@capsule/openclaw";
import { DEFAULT_CAPSULE_SETTINGS } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(options: { safeMode?: boolean } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-settings-file-"));
  const configDir = path.join(profile, "home", ".capsule");
  const settingsFile = path.join(configDir, "settings.json");
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const open = async () => {
    const engine = new CapsuleEngine({
      databasePath: path.join(profile, "state.sqlite"),
      userDataDir: profile,
      configDir,
      autoConnect: false,
      safeMode: options.safeMode,
    });
    for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
    cleanups.push(() => engine.stop());
    return engine;
  };
  const write = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2));
  };
  const project = (engine: CapsuleEngine, settings?: unknown) => {
    const root = path.join(profile, "project");
    mkdirSync(root, { recursive: true });
    if (settings) write(path.join(root, ".capsule", "settings.json"), settings);
    return engine.createProject({ name: "Settings fixture", workingDirectory: root });
  };
  return { profile, configDir, settingsFile, open, write, project };
}

it("keeps a saved preference in the user file across a restart", async () => {
  const { open, settingsFile } = fixture();
  const first = await open();
  await first.start();
  await first.updateSettings({ transcriptSize: "l", diffLayout: DEFAULT_CAPSULE_SETTINGS.diffLayout });
  expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toMatchObject({ transcriptSize: "l" });
  expect(JSON.parse(readFileSync(settingsFile, "utf8"))).not.toHaveProperty("diffLayout");
  await first.stop();

  const second = await open();
  await second.start();
  expect(second.getSettings().transcriptSize).toBe("l");
});

it("moves the database settings into the file on first launch and leaves the row as a backup", async () => {
  const { open, settingsFile } = fixture();
  const engine = await open();
  engine.repos.setSetting("settings", JSON.stringify({ diffLayout: "unified", gatewayToken: "fixture-token" }));
  await engine.start();
  expect(engine.getSettings().diffLayout).toBe("unified");
  const file = readFileSync(settingsFile, "utf8");
  expect(JSON.parse(file)).toMatchObject({ diffLayout: "unified" });
  expect(file).not.toContain("fixture-token");
  expect(engine.repos.getSetting("settings")).toContain("unified");
  expect(engine.repos.getSetting("settings")).not.toContain("fixture-token");
});

it("applies a hand edit to the user file and tells the window", async () => {
  const { open, write, settingsFile } = fixture();
  const engine = await open();
  await engine.start();
  const state = vi.fn();
  engine.events.on("state", state);
  write(settingsFile, { transcriptSize: "s", sandbox: "strict" });
  await vi.waitFor(() => expect(engine.getSettings().transcriptSize).toBe("s"), { timeout: 5000 });
  expect(state).toHaveBeenCalledWith({ command: "settings-updated" });
  expect(state).toHaveBeenCalledWith({ command: "config-updated" });
  // The derived policy follows the file, as it would follow the Settings screen.
  expect(() => engine.assertLocalCommandsAllowed()).toThrow();
});

it("starts a conversation with the project's own defaults", async () => {
  const { open, project } = fixture();
  const engine = await open();
  await engine.start();
  const created = project(engine, { defaultPermission: "strict", defaultAgentId: "research" });
  const session = await engine.createSession({ projectId: created.id, title: "From the project file" });
  expect(session.permissionProfile).toBe("strict");
  expect(session.agentId).toBe("research");
  // A mode names its own agent; the file only fills what the caller left out.
  const coding = await engine.createSession({ projectId: created.id, mode: "code", permissionProfile: "default" });
  expect(coding.agentId).not.toBe("research");
  expect(coding.permissionProfile).toBe("default");
  const user = await engine.createSession({ projectId: engine.listProjects().find((item) => item.id !== created.id)!.id });
  expect(user.permissionProfile).toBe(DEFAULT_CAPSULE_SETTINGS.defaultPermission);
});

it("sends a project's instructions with each turn in that project", async () => {
  const { open, project } = fixture();
  const engine = await open();
  await engine.start();
  const created = project(engine, { commitInstructions: "Use the imperative mood." });
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
  const session = await engine.createSession({ projectId: created.id });
  await engine.sendMessage({ sessionId: session.id, content: "Commit the change." });
  expect(sent.mock.calls.at(-1)?.[0].content).toContain("Commit messages: Use the imperative mood.");
});

it("writes a project value to the project file and reports where it came from", async () => {
  const { open, project } = fixture();
  const engine = await open();
  await engine.start();
  const created = project(engine);
  const state = vi.fn();
  engine.events.on("state", state);
  const snapshot = engine.setConfigValue({ key: "diffLayout", value: "unified", scope: "project", projectId: created.id });
  const file = path.join(created.workingDirectory!, ".capsule", "settings.json");
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ diffLayout: "unified" });
  expect(snapshot.project?.settings.diffLayout).toBe("unified");
  expect(snapshot.project?.provenance.diffLayout).toEqual({ scope: "project", path: file });
  expect(snapshot.settings.diffLayout).toBe(DEFAULT_CAPSULE_SETTINGS.diffLayout);
  expect(state).toHaveBeenCalledWith({ command: "config-updated" });
});

it("trusts and revokes a project folder", async () => {
  const { open, project } = fixture();
  const engine = await open();
  await engine.start();
  const created = project(engine, { hooks: { TurnEnd: [{ hooks: [{ type: "command", command: "make notify" }] }] } });
  expect(engine.getConfigDiagnostics(created.id).trust).toMatchObject({ trusted: false, pending: [{ kind: "hook" }] });
  expect(engine.trustProject(created.id, true).project?.trusted).toBe(true);
  expect(engine.config.extended(created.workingDirectory).hooks.TurnEnd).toHaveLength(1);
  expect(engine.trustProject(created.id, false).project?.trusted).toBe(false);
  expect(engine.config.extended(created.workingDirectory).hooks).toEqual({});
});

it("reads no file in safe mode and refuses to save preferences", async () => {
  const { open, write, settingsFile } = fixture({ safeMode: true });
  write(settingsFile, { transcriptSize: "l" });
  const engine = await open();
  await engine.start();
  expect(engine.getSettings().transcriptSize).toBe(DEFAULT_CAPSULE_SETTINGS.transcriptSize);
  expect(engine.getConfigSnapshot().safeMode).toBe(true);
  await expect(engine.updateSettings({ transcriptSize: "s" })).rejects.toThrow("Safe mode is on");
  expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ transcriptSize: "l" });
});

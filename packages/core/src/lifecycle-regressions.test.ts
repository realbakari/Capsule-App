import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";
import { CAPSULE_KEYCHAIN_SERVICE, SKILLS_SH_TOKEN_ACCOUNT } from "./keychain.js";
import { policiesFromSettings } from "@capsule/policies";
import { MockAgentRuntime } from "@capsule/openclaw";

const commands = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@capsule/terminal", async (original) => ({ ...await original<typeof import("@capsule/terminal")>(), startInDirectory: commands.start }));
function fixture() {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-lifecycle-"));
  return { profile, engine: new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, autoConnect: false }) };
}

it("migrates the catalog token out of settings and never persists its value or mask again", async () => {
  const { engine } = fixture();
  const secrets = new Map<string, string>();
  vi.spyOn(engine.keychain, "get").mockImplementation(async (_service, account) => secrets.get(account));
  const save = vi.spyOn(engine.keychain, "set").mockImplementation(async (_service, account, value) => { secrets.set(account, value); });
  vi.spyOn(engine.keychain, "delete").mockImplementation(async (_service, account) => { secrets.delete(account); });
  engine.repos.setSetting("settings", JSON.stringify({ skillsShToken: "legacy-catalog-secret" }));
  await engine.start();
  try {
    expect(save).toHaveBeenCalledWith(CAPSULE_KEYCHAIN_SERVICE, SKILLS_SH_TOKEN_ACCOUNT, "legacy-catalog-secret");
    expect(engine.repos.getSetting("settings")).not.toContain("skillsShToken");
    expect(engine.getSettings().skillsShToken).toBe("••••");
    await engine.updateSettings({ transcriptSize: "l", skillsShToken: "••••" });
    expect(engine.repos.getSetting("settings")).not.toContain("skillsShToken");
    expect(secrets.get(SKILLS_SH_TOKEN_ACCOUNT)).toBe("legacy-catalog-secret");
    await engine.updateSettings({ skillsShToken: "" });
    expect(secrets.has(SKILLS_SH_TOKEN_ACCOUNT)).toBe(false);
    expect(engine.getSettings().skillsShToken).toBeUndefined();
  } finally { await engine.stop(); }
});

it("applies policies and projectless-folder binding when restoring defaults", async () => {
  const { engine, profile } = fixture(); await engine.start();
  try {
    const inbox = engine.listProjects().find((project) => project.name === "Inbox")!;
    const defaultFolder = engine.getProject(inbox.id)?.workingDirectory;
    await engine.updateSettings({ webAccess: "off", sandbox: "strict", projectlessFolder: path.join(profile, "custom") });
    expect(engine.getProject(inbox.id)?.workingDirectory).not.toBe(defaultFolder);
    const notify = vi.fn(); engine.events.on("state", notify);
    await engine.resetSettingsSection("agents");
    await engine.resetSettingsSection("projects");
    const settings = engine.getSettings();
    for (const rule of policiesFromSettings(settings)) expect(engine.repos.listPolicies().find((stored) => stored.id === rule.id)).toMatchObject(rule);
    expect(engine.getProject(inbox.id)?.workingDirectory).toBe(defaultFolder);
    expect(notify).toHaveBeenCalledWith({ command: "settings-updated" });
    expect(() => engine.assertLocalCommandsAllowed()).not.toThrow();
  } finally { await engine.stop(); }
});

it("keeps a stopping action owned until exit and ignores the old process's late exit", async () => {
  const { engine, profile } = fixture(); await engine.start();
  const children: Array<{ stop: ReturnType<typeof vi.fn>; handlers: Parameters<typeof import("@capsule/terminal").startInDirectory>[2] }> = [];
  commands.start.mockImplementation((_cwd, _command, handlers) => {
    const child = { stop: vi.fn(), handlers }; children.push(child); return { pid: children.length, stop: child.stop };
  });
  try {
    const project = engine.createProject({ name: "Actions", workingDirectory: profile });
    engine.updateProject(project.id, { actions: [{ id: "dev", name: "Dev", command: "fixture" }] });
    const first = engine.runProjectAction(project.id, "dev");
    expect(engine.stopProjectAction(project.id, "dev").status).toBe("stopping");
    expect(engine.runProjectAction(project.id, "dev")).toBe(first);
    expect(children).toHaveLength(1);
    children[0]!.handlers.onExit(null, "SIGTERM");
    expect(first.status).toBe("stopped");
    const next = engine.runProjectAction(project.id, "dev");
    children[0]!.handlers.onExit(null, "SIGTERM");
    engine.stopProjectAction(project.id, "dev");
    expect(children[1]?.stop).toHaveBeenCalledTimes(1);
    children[1]!.handlers.onExit(null, "SIGTERM");
    expect(next.status).toBe("stopped");
  } finally { await engine.stop(); }
});

it("resolves project skills for both preview and submission in the thread's working folder", async () => {
  const { engine, profile } = fixture(); await engine.start();
  try {
    const main = path.join(profile, "project"), isolated = path.join(profile, "isolated");
    const skillDir = path.join(isolated, ".claude", "skills", "capsule-fixture-instructions");
    mkdirSync(main); mkdirSync(skillDir, { recursive: true });
    const content = "---\nname: capsule-fixture-instructions\ndescription: Test instructions\n---\n# Scope\nOnly change fixture files.\n";
    writeFileSync(path.join(skillDir, "SKILL.md"), content);
    writeFileSync(path.join(skillDir, "example.txt"), "Example file");
    const project = engine.createProject({ name: "Skills", workingDirectory: main });
    const thread = await engine.createSession({ projectId: project.id, mode: "chat", agentId: "general" });
    engine.repos.updateSession({ ...thread, workingDirectory: isolated });
    expect((await engine.listSkills(project.id)).find((skill) => skill.name === "capsule-fixture-instructions")).toBeUndefined();
    const skill = (await engine.listSkills(project.id, thread.id)).find((entry) => entry.name === "capsule-fixture-instructions")!;
    expect(skill).toBeDefined();
    expect((await engine.listSkillFiles(skill.id, ".", project.id, thread.id)).map((file) => file.name)).toContain("example.txt");
    expect(await engine.previewSkillFile(skill.id, "example.txt", project.id, thread.id)).toMatchObject({ contents: "Example file" });
    await expect(engine.sendMessage({ sessionId: thread.id, content: "Test", skillId: "missing-fixture-skill", agentId: "general", mode: "chat" })).rejects.toThrow("Unknown skill");
    expect(engine.listMessages(thread.id)).toHaveLength(0);
    const send = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
    const result = await engine.sendMessage({ sessionId: thread.id, content: "Test", skillId: skill.id, agentId: "general", mode: "chat" });
    expect(send.mock.calls.at(-1)?.[0].content).toContain("Only change fixture files.");
    send.mockRestore();
    await engine.stopRun(result.run.id);
  } finally { await engine.stop(); }
});

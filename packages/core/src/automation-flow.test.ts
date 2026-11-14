import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentRuntime } from "@capsule/openclaw";
import type { StatusLineRender } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";
import { isInboxProject } from "./projectless.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(settings: object) {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-automation-engine-"));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const configDir = path.join(profile, "home", ".capsule");
  const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  write(path.join(configDir, "settings.json"), JSON.stringify(settings));
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir, autoConnect: false });
  for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
  cleanups.push(() => engine.stop());
  await engine.start();
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
  return { engine, configDir, write, sent, profile };
}

it("runs an automation into a new unread Inbox thread, sending its command through the normal send path", async () => {
  const f = await fixture({ automations: [{ id: "hello", name: "Say hello", schedule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", command: "hello" }] });
  f.write(path.join(f.configDir, "commands", "hello.md"), "Say hello to the team.");
  f.engine.reloadConfig();
  const [view] = f.engine.getConfigSnapshot().automations;
  expect(view).toMatchObject({ key: "user:hello", name: "Say hello", scheduleText: "Every day at 9:00", enabled: true });
  await f.engine.runAutomationNow({ key: "user:hello" });
  const inbox = f.engine.listProjects().find((project) => isInboxProject(project))!;
  const thread = f.engine.listSessions(inbox.id).find((session) => session.automationId === "user:hello")!;
  expect(thread.title.startsWith("Say hello · ")).toBe(true);
  expect(thread.unread).toBe(true);
  expect(f.sent.mock.calls.at(-1)?.[0].content).toContain("Say hello to the team.");
  await vi.waitFor(() => expect(f.engine.getConfigSnapshot().automations[0]!.lastRun?.status).toBe("completed"), { timeout: 10_000 });
  expect(f.engine.getConfigSnapshot().automations[0]!.lastRun?.sessionId).toBe(thread.id);
  expect(f.engine.getConfigDiagnostics().runs.at(-1)).toMatchObject({ kind: "automation", label: "Say hello", outcome: "completed" });
  f.engine.markSessionRead(thread.id);
  expect(f.engine.listSessions(inbox.id).find((session) => session.id === thread.id)?.unread).toBeFalsy();
});

it("pauses by writing enabled to the file that defines it, and adds a template paused", async () => {
  const f = await fixture({ automations: [{ id: "beat", name: "Beat", schedule: "RRULE:FREQ=MINUTELY;INTERVAL=5", prompt: "Tick" }] });
  f.engine.setAutomationEnabled({ key: "user:beat", enabled: false });
  const file = path.join(f.configDir, "settings.json");
  expect(JSON.parse(readFileSync(file, "utf8")).automations[0]).toMatchObject({ id: "beat", enabled: false });
  expect(f.engine.getConfigSnapshot().automations[0]).toMatchObject({ enabled: false });
  expect(f.engine.createAutomation({ template: "triage", scope: "user" })).toBe(file);
  const written = JSON.parse(readFileSync(file, "utf8")).automations;
  expect(written.map((entry: { id: string; enabled?: boolean }) => [entry.id, entry.enabled])).toEqual([["beat", false], ["triage-issues", false]]);
  f.engine.createAutomation({ template: "triage", scope: "user" });
  expect(JSON.parse(readFileSync(file, "utf8")).automations.at(-1).id).toBe("triage-issues-2");
});

it("runs the person's status line command with the thread on stdin and publishes what it printed", async () => {
  const f = await fixture({});
  const script = path.join(f.profile, "line.sh");
  writeFileSync(script, `cat > ${JSON.stringify(path.join(f.profile, "stdin.json"))}\nprintf '\\033[1mready\\033[0m\\n'\n`);
  f.write(path.join(f.configDir, "settings.json"), JSON.stringify({ statusLine: { items: ["branch"], command: `sh ${JSON.stringify(script)}` } }));
  f.engine.reloadConfig();
  const root = path.join(f.profile, "project");
  mkdirSync(root, { recursive: true });
  const project = f.engine.createProject({ name: "Status fixture", workingDirectory: root });
  const session = await f.engine.createSession({ projectId: project.id });
  const renders: StatusLineRender[] = [];
  f.engine.events.on("state", (payload: { command?: string; render?: StatusLineRender }) => { if (payload.command === "status-line-updated" && payload.render) renders.push(payload.render); });
  f.engine.runStatusLine({ projectId: project.id, sessionId: session.id, facts: { branch: "main", context: { used: 50, size: 200 }, cwd: "/etc", bogus: true } });
  await vi.waitFor(() => expect(renders).toHaveLength(1), { timeout: 10_000 });
  expect(renders[0]).toMatchObject({ key: session.id, lines: [[{ bold: true, text: "ready" }]] });
  const stdin = JSON.parse(readFileSync(path.join(f.profile, "stdin.json"), "utf8"));
  expect(stdin).toMatchObject({ thread_id: session.id, project_dir: root, cwd: root, branch: "main", context_percent: 25 });
  expect(stdin).not.toHaveProperty("bogus");
  const snapshot = f.engine.getConfigSnapshot(project.id);
  expect(snapshot.statusLine).toMatchObject({ items: ["branch"], command: `sh ${JSON.stringify(script)}`, renders: [{ key: session.id }] });
});

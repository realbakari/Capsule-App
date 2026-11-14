import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentRuntime } from "@capsule/openclaw";
import { CapsuleEngine } from "./engine.js";
import { UNTRUSTED_SHELL } from "./commands.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-commands-engine-"));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const configDir = path.join(profile, "home", ".capsule");
  const root = path.join(profile, "project");
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(path.join(root, "src", "app.ts"), "export {};\n");
  write(path.join(profile, "secret.txt"), "not yours\n");
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir, autoConnect: false });
  for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
  cleanups.push(() => engine.stop());
  await engine.start();
  const project = engine.createProject({ name: "Commands fixture", workingDirectory: root });
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
  const send = async (content: string) => {
    const session = await engine.createSession({ projectId: project.id, title: "New conversation", mode: "chat", agentId: "general" });
    const result = await engine.sendMessage({ sessionId: session.id, content, mode: "chat", agentId: "general" });
    return { ...result, received: sent.mock.calls.at(-1)?.[0], events: engine.listRunEvents(result.run.id) };
  };
  return {
    engine,
    project,
    root,
    send,
    user: (name: string, text: string) => write(path.join(configDir, "commands", name), text),
    team: (name: string, text: string) => write(path.join(root, ".capsule", "commands", name), text),
  };
}

it("sends the agent the expanded command and keeps what was typed in the thread", async () => {
  const f = await fixture();
  f.user("review-pr.md", "---\ndescription: Review a pull request\narguments: [number]\n---\nReview pull request #$number. Read @src/app.ts first.");
  const { received, userMessage, run, events } = await f.send("/review-pr 123");

  expect(received?.content).toContain("Review pull request #123. Read @src/app.ts first.");
  expect(received?.content).not.toContain("/review-pr");
  expect(userMessage.content).toBe("/review-pr 123");
  expect(f.engine.listMessages(userMessage.sessionId).find((message) => message.role === "user")?.content).toBe("/review-pr 123");
  expect(run.prompt).toBe("/review-pr 123");
  expect(userMessage.attachments?.map((file) => path.basename(file.path))).toEqual(["app.ts"]);
  expect(events.find((event) => event.type === "command.expanded")).toMatchObject({
    message: expect.stringMatching(/^Expanded \/review-pr from .*review-pr\.md$/),
    data: { command: "review-pr", source: "user" },
  });
});

it("leaves a message that names no Capsule command alone", async () => {
  const f = await fixture();
  const { received, events } = await f.send("/compact please");
  expect(received?.content.startsWith("/compact please")).toBe(true);
  expect(events.some((event) => event.type === "command.expanded")).toBe(false);
});

it("runs a project command's shell only once the folder is trusted, and the user's always", async () => {
  const f = await fixture();
  f.team("status.md", "Team: !`echo from-team`");
  f.user("mine.md", "Mine: !`echo from-me; exit 3`");

  const untrusted = await f.send("/status");
  expect(untrusted.received?.content).toContain(`Team: ${UNTRUSTED_SHELL}`);
  expect(untrusted.events.find((event) => event.type === "command.expanded")?.message).toMatch(/wait until you trust this project/);
  expect(f.engine.getConfigDiagnostics(f.project.id).trust?.pending).toContainEqual(expect.objectContaining({ kind: "command-shell", detail: "/status: echo from-team" }));

  const mine = await f.send("/mine");
  expect(mine.received?.content).toContain("Mine: from-me\n(exit 3)");

  f.engine.trustProject(f.project.id, true);
  const trusted = await f.send("/status");
  expect(trusted.received?.content).toContain("Team: from-team");
  expect(f.engine.getConfigDiagnostics().runs.map((record) => [record.kind, record.command, record.exitCode])).toEqual([
    ["command-shell", "echo from-me; exit 3", 3],
    ["command-shell", "echo from-team", 0],
  ]);
});

it("refuses an @ mention outside the conversation's folder", async () => {
  const f = await fixture();
  f.user("leak.md", "Read @../secret.txt and @src/app.ts");
  const { userMessage, events } = await f.send("/leak");
  expect(userMessage.attachments?.map((file) => path.basename(file.path))).toEqual(["app.ts"]);
  expect(events.find((event) => event.type === "command.expanded")?.message).toContain("@../secret.txt is outside this conversation's folder");
});

it("starts a conversation in the command's mode", async () => {
  const f = await fixture();
  f.user("plan-it.md", "---\nmode: plan\n---\nPlan the change.");
  const { session, received } = await f.send("/plan-it");
  expect(session.mode).toBe("plan");
  expect(received?.mode).toBe("plan");
});

it("lists commands for the menu and expands one for review without sending it", async () => {
  const f = await fixture();
  f.team("draft.md", "---\ndescription: Draft notes\nargument-hint: <topic>\nsend: review\n---\nNotes on $ARGUMENTS: !`echo ok`");
  expect(f.engine.listCommands(f.project.id)).toEqual({
    commands: [{ name: "draft", description: "Draft notes", argumentHint: "<topic>", source: "project", scope: "project", path: path.join(f.root, ".capsule", "commands", "draft.md"), send: "review", shell: "needs-trust" }],
    problems: [],
    sources: {},
  });
  f.engine.trustProject(f.project.id, true);
  expect(f.engine.listCommands(f.project.id).commands[0]?.shell).toBe("runs");
  await expect(f.engine.expandCommand({ projectId: f.project.id, text: "/draft caching" })).resolves.toEqual({ text: "Notes on caching: ok", attachments: [], problems: [] });
  await expect(f.engine.expandCommand({ projectId: f.project.id, text: "/nothing" })).rejects.toThrow("/nothing is not a Capsule command.");
});

/*
 * A command's worktree can be asked for from a paired device, a queue or a
 * channel, in a folder nobody trusted. What it may start is the setup
 * actions saved in Capsule, which are the person's own; the repository's
 * capsule.json setup actions must not run from here.
 */
it("starts a command's worktree in an untrusted folder running only the person's saved setup actions", async () => {
  const f = await fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "capsule@example.test");
  git("config", "user.name", "Capsule Test");
  writeFileSync(path.join(f.root, "capsule.json"), JSON.stringify({ actions: [{ name: "Install", command: "pwd", runOnWorktreeCreate: true }] }));
  git("add", ".");
  git("commit", "-qm", "initial");
  f.engine.updateProject(f.project.id, { actions: [{ id: "setup", name: "Setup", command: "pwd", runOnWorktreeCreate: true }] });
  f.user("wt.md", "---\nworkspace: worktree\n---\nStart fresh.");
  const started = await f.send("/wt");
  expect(f.engine.listSessions().find((item) => item.id === started.session.id)?.workspaceMode).toBe("worktree");
  expect(f.engine.listProjectActionRuns(f.project.id, started.session.id).map((run) => run.actionId)).toEqual(["setup"]);
});

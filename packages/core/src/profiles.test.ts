import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentRuntime } from "@capsule/openclaw";
import { STANDING_OPEN } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-profiles-engine-"));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const configDir = path.join(profile, "home", ".capsule");
  const root = path.join(profile, "project");
  const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  mkdirSync(root, { recursive: true });
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir, autoConnect: false });
  for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
  cleanups.push(() => engine.stop());
  await engine.start();
  const project = engine.createProject({ name: "Profiles fixture", workingDirectory: root });
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
  const send = async (sessionId: string, content: string, extra: { agentId?: string; mode?: "chat" | "code" } = {}) => {
    const result = await engine.sendMessage({ sessionId, content, ...extra });
    await vi.waitFor(() => expect(engine.listRuns(sessionId).every((run) => run.completedAt)).toBe(true), { timeout: 10_000 });
    return { ...result, received: sent.mock.calls.at(-1)?.[0], events: engine.listRunEvents(result.run.id) };
  };
  return {
    engine, project, root, configDir, send, write,
    settings: (value: object) => { write(path.join(configDir, "settings.json"), JSON.stringify(value)); engine.reloadConfig(); },
    profile: (name: string, text: string) => { write(path.join(configDir, "profiles", `${name}.md`), text); engine.reloadConfig(); },
  };
}

const REVIEWER = "---\nname: Reviewer\nharness: codex\nmodel: gpt-test\neffort: high\npermission: strict\nmode: plan\nworkspace: worktree\nstyle: concise\nmcp: [docs]\n---\nLead with risks.";

it("starts a conversation from a profile: agent, mode, permission, model and which profile, in one pick", async () => {
  const f = await fixture();
  f.profile("reviewer", REVIEWER);
  const session = await f.engine.createSession({ projectId: f.project.id, profileId: "reviewer" });
  expect(session).toMatchObject({ profileId: "reviewer", agentId: "codex", mode: "code", permissionProfile: "strict", modelOverride: "gpt-test", workspaceMode: "local" });
  expect(f.engine.listSessions(f.project.id).find((item) => item.id === session.id)?.profileId).toBe("reviewer");
  const named = await f.engine.createSession({ projectId: f.project.id, profileId: "reviewer", permissionProfile: "default" });
  expect(named.permissionProfile).toBe("default");
  await expect(f.engine.createSession({ projectId: f.project.id, profileId: "nope" })).rejects.toThrow("There is no profile named nope here.");
});

it("sends the profile's instructions and its style once, before the first message, never as the person's words", async () => {
  const f = await fixture();
  f.profile("reviewer", REVIEWER);
  const session = await f.engine.createSession({ projectId: f.project.id, profileId: "reviewer" });
  const first = await f.send(session.id, "Check the parser");
  expect(first.received?.content.startsWith(STANDING_OPEN)).toBe(true);
  expect(first.received?.content).toContain("## Response style: Concise");
  expect(first.received?.content).toContain("## Profile: Reviewer\nLead with risks.");
  expect(first.received?.content).toContain("Check the parser");
  expect(first.userMessage.content).toBe("Check the parser");
  expect(first.events.find((event) => event.type === "standing.instructions")?.data).toMatchObject({ style: "concise", profile: "reviewer" });
  const second = await f.send(session.id, "And the lexer");
  expect(second.received?.content).not.toContain(STANDING_OPEN);
});

it("reads outputDetail as a style, lets style replace it, and adds personal instructions", async () => {
  const f = await fixture();
  f.write(path.join(f.configDir, "me.md"), "I use pnpm.");
  f.settings({ outputDetail: "verbose", personalInstructions: "me.md" });
  const plain = await f.engine.createSession({ projectId: f.project.id, agentId: "general", mode: "chat" });
  const verbose = await f.send(plain.id, "Hello");
  expect(verbose.received?.content).toContain("## Response style: Explanatory");
  expect(verbose.received?.content).toContain("## Personal instructions\nI use pnpm.");
  f.settings({ outputDetail: "verbose", style: "standard" });
  const standard = await f.engine.createSession({ projectId: f.project.id, agentId: "general", mode: "chat" });
  expect((await f.send(standard.id, "Hello")).received?.content.startsWith("Hello")).toBe(true);
});

it("applies a command's profile when the command starts the conversation", async () => {
  const f = await fixture();
  f.profile("reviewer", REVIEWER);
  f.write(path.join(f.configDir, "commands", "review.md"), "---\nprofile: reviewer\n---\nReview $ARGUMENTS");
  f.engine.reloadConfig();
  const session = await f.engine.createSession({ projectId: f.project.id, agentId: "general", mode: "chat" });
  const result = await f.send(session.id, "/review src", { agentId: "general", mode: "chat" });
  expect(f.engine.listSessions(f.project.id).find((item) => item.id === session.id)).toMatchObject({ profileId: "reviewer", harnessId: "codex", mode: "code" });
  expect(result.received?.content).toContain("## Profile: Reviewer");
  expect(result.received?.content).toContain("Review src");
});

it("offers configured servers with Capsule's own, filtered by project, profile and secrets", async () => {
  const f = await fixture();
  f.profile("reviewer", REVIEWER);
  process.env.CAPSULE_TEST_MCP_TOKEN = "t0ken";
  cleanups.push(() => { delete process.env.CAPSULE_TEST_MCP_TOKEN; });
  f.settings({ mcpServers: {
    docs: { command: "docs-mcp", env: { TOKEN: "${env:CAPSULE_TEST_MCP_TOKEN}" } },
    db: { url: "https://db.example.test/mcp", projects: ["/elsewhere/**"] },
    "capsule-browser": { command: "impostor" },
    wiki: { url: "https://wiki.example.test/mcp", headers: { Authorization: "${env:CAPSULE_TEST_UNSET}" } },
  } });
  f.engine.offerDirectMcpServers(() => ({ servers: [{ type: "http", name: "capsule-browser", url: "http://127.0.0.1:1/mcp" }], dispose: () => {} }));
  const offer = (threadId?: string) => (f.engine as unknown as { mcpOffer(input: object): { servers: Array<{ name: string }> } }).mcpOffer({ threadId, harnessId: "codex" }).servers;
  const plain = await f.engine.createSession({ projectId: f.project.id, agentId: "codex", mode: "code" });
  expect(offer(plain.id)).toEqual([
    { type: "http", name: "capsule-browser", url: "http://127.0.0.1:1/mcp" },
    { name: "docs", command: "docs-mcp", args: [], env: [{ name: "TOKEN", value: "t0ken" }] },
  ]);
  f.settings({ mcpServers: { docs: { command: "docs-mcp" }, other: { command: "other-mcp" } } });
  const reviewer = await f.engine.createSession({ projectId: f.project.id, profileId: "reviewer" });
  expect(offer(reviewer.id).map((server) => server.name)).toEqual(["capsule-browser", "docs"]);

  const snapshot = f.engine.getConfigSnapshot(f.project.id);
  expect(snapshot.mcpServers.map((server) => [server.name, server.status.state])).toEqual([["docs", "offered"], ["other", "offered"]]);
  expect(snapshot.profiles.map((item) => item.id)).toEqual(["reviewer"]);
  expect(snapshot.styles.selected).toBe("standard");
});

it("tests a stdio server by listing its tools, and says why one fails", async () => {
  const f = await fixture();
  const script = path.join(f.root, "tiny.mjs");
  f.write(script, `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "t", version: "1" } } }) + "\\n");
  if (m.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo" }, { name: "whoami" }] } }) + "\\n");
});`);
  f.settings({ mcpServers: { tiny: { command: process.execPath, args: [script] }, broken: { command: process.execPath, args: ["-e", "process.exit(3)"] } } });
  await expect(f.engine.testMcpServer({ name: "tiny", projectId: f.project.id })).resolves.toMatchObject({ ok: true, tools: ["echo", "whoami"] });
  await expect(f.engine.testMcpServer({ name: "broken" })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/exited \(code 3\)/) });
  await expect(f.engine.testMcpServer({ name: "missing" })).rejects.toThrow(/no MCP server named missing/);
}, 30_000);

it("sets a direct agent's effort and plan controls from the profile, and says what the Gateway cannot carry", async () => {
  const f = await fixture();
  f.profile("reviewer", REVIEWER);
  const session = await f.engine.createSession({ projectId: f.project.id, profileId: "reviewer" });
  const engine = f.engine as unknown as {
    usingMock: boolean;
    harnessStatus(id: string): Promise<unknown>;
    setHarnessConfig(id: string, configId: string, value: string): Promise<unknown>;
    applyProfileControls(session: object, profile: object): Promise<string[]>;
    repos: { updateSession(session: object): void };
  };
  const profile = f.engine.config.profiles(f.root).profiles[0]!.profile;
  engine.usingMock = false;
  engine.repos.updateSession({ ...session, harnessId: "codex", openclawSessionKey: "direct:codex:codex:1" });
  vi.spyOn(engine, "harnessStatus").mockResolvedValue({ parsed: { reported: { configOptions: [
    { id: "reasoning_effort", category: "thought_level", name: "Effort", currentValue: "medium", choices: [{ value: "medium" }, { value: "high" }] },
    { id: "permissions", category: "permissions", name: "Permissions", currentValue: "default", choices: [{ value: "default" }] },
  ] } } });
  const set = vi.spyOn(engine, "setHarnessConfig").mockResolvedValue({});
  expect(await engine.applyProfileControls(session, profile)).toEqual(["This agent reports no mode control that takes plan, so the profile's mode was not applied."]);
  expect(set).toHaveBeenCalledWith(session.id, "reasoning_effort", "high");

  engine.repos.updateSession({ ...session, harnessId: "codex", openclawSessionKey: "agent:codex:acp:1" });
  expect(await engine.applyProfileControls(session, profile)).toEqual([
    "The Gateway route has no effort control, so the profile's effort high was not applied.",
    "The Gateway route has no mode control, so the profile's mode plan was not applied.",
  ]);
  engine.usingMock = true;
});

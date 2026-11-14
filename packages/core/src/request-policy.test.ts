import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DirectAcpHost, DirectAcpSession } from "@capsule/acp";
import { MockAgentRuntime } from "@capsule/openclaw";
import type { Run, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

async function fixture(settings: { user?: unknown; project?: unknown } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-policy-"));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const configDir = path.join(profile, "home", ".capsule");
  const root = path.join(profile, "project");
  mkdirSync(root, { recursive: true });
  if (settings.user) write(path.join(configDir, "settings.json"), JSON.stringify(settings.user));
  if (settings.project) write(path.join(root, ".capsule", "settings.json"), JSON.stringify(settings.project));
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir, autoConnect: false });
  for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
  cleanups.push(() => engine.stop());
  await engine.start();
  const project = engine.createProject({ name: "Policy fixture", workingDirectory: root });
  const thread = () => engine.createSession({ projectId: project.id, title: "New conversation", mode: "chat", agentId: "general" });
  const script = (name: string, body: string) => {
    const file = path.join(profile, name);
    write(file, body);
    return `sh ${JSON.stringify(file)}`;
  };
  return { engine, project, root, profile, configDir, thread, script };
}

const settled = (engine: CapsuleEngine, runId: string) =>
  vi.waitFor(() => expect(engine.getRun(runId)?.completedAt).toBeTruthy(), { timeout: 8000 });

it("answers a Gateway approval by an allow rule, with an audit line and no card", async () => {
  const f = await fixture({ user: { permissions: { allow: ["edit(~/Projects/app/**)"] } } });
  const resolved = vi.spyOn(MockAgentRuntime.prototype, "resolveApproval");
  const session = await f.thread();
  const { run } = await f.engine.sendMessage({ sessionId: session.id, content: "[approval] change the router", mode: "chat", agentId: "general" });
  await settled(f.engine, run.id);
  expect(f.engine.getRun(run.id)?.status).toBe("completed");
  expect(resolved).toHaveBeenCalledWith(expect.any(String), "approved_once");
  expect(f.engine.listApprovals()).toEqual([]);
  expect(f.engine.listRunEvents(run.id).find((event) => event.type === "approval.auto")?.message)
    .toBe(`Allowed by edit(~/Projects/app/**) in ${path.join(f.configDir, "settings.json")}`);
});

it("denies by a deny rule over an allow rule", async () => {
  const f = await fixture({ user: { permissions: { allow: ["edit"], deny: ["edit(~/**/router.ts)"] } } });
  const resolved = vi.spyOn(MockAgentRuntime.prototype, "resolveApproval");
  const session = await f.thread();
  const { run } = await f.engine.sendMessage({ sessionId: session.id, content: "[approval] change the router", mode: "chat", agentId: "general" });
  await settled(f.engine, run.id);
  expect(resolved).toHaveBeenCalledWith(expect.any(String), "denied");
  expect(f.engine.listRunEvents(run.id).find((event) => event.type === "approval.auto")?.message).toMatch(/^Denied by edit\(~\/\*\*\/router\.ts\)/);
});

it("leaves an ask rule and an untrusted project's allow rule to the person", async () => {
  const f = await fixture({ user: { permissions: { ask: ["edit(~/Projects/**)"] } }, project: { permissions: { allow: ["edit"] } } });
  const session = await f.thread();
  const { run } = await f.engine.sendMessage({ sessionId: session.id, content: "[approval] change the router", mode: "chat", agentId: "general" });
  await vi.waitFor(() => expect(f.engine.listApprovals("pending")).toHaveLength(1), { timeout: 8000 });
  expect(f.engine.listRunEvents(run.id).find((event) => event.type === "approval.auto")?.message).toMatch(/^Asked by edit\(~\/Projects\/\*\*\)/);

  const plain = await fixture({ project: { permissions: { allow: ["edit"] } } });
  const other = await plain.thread();
  const second = await plain.engine.sendMessage({ sessionId: other.id, content: "[approval] change the router", mode: "chat", agentId: "general" });
  await vi.waitFor(() => expect(plain.engine.listApprovals("pending")).toHaveLength(1), { timeout: 8000 });
  expect(plain.engine.listRunEvents(second.run.id).some((event) => event.type === "approval.auto")).toBe(false);
  plain.engine.trustProject(plain.project.id, true);
  const third = await plain.engine.sendMessage({ sessionId: (await plain.thread()).id, content: "[approval] change the router", mode: "chat", agentId: "general" });
  await settled(plain.engine, third.run.id);
  expect(plain.engine.getRun(third.run.id)?.status).toBe("completed");
});

it("refuses a prompt a PromptSubmit hook blocks, before anything is recorded", async () => {
  const f = await fixture();
  const hook = f.script("block.sh", `cat > "$CAPSULE_PROJECT_DIR/../seen.json"\necho "This looks like an API key" >&2\nexit 2\n`);
  write(path.join(f.configDir, "settings.json"), JSON.stringify({ hooks: { PromptSubmit: [{ hooks: [{ type: "command", command: hook }] }] } }));
  f.engine.reloadConfig();
  const session = await f.thread();
  await expect(f.engine.sendMessage({ sessionId: session.id, content: "token sk-live-123", mode: "chat", agentId: "general" }))
    .rejects.toThrow(`Blocked by hook: This looks like an API key. (PromptSubmit hook in ${path.join(f.configDir, "settings.json")})`);
  expect(f.engine.listMessages(session.id)).toEqual([]);
  expect(f.engine.listRuns(session.id)).toEqual([]);
  expect(JSON.parse(readFileSync(path.join(f.profile, "seen.json"), "utf8"))).toMatchObject({ event: "PromptSubmit", prompt: "token sk-live-123", project_dir: f.root });
  expect(f.engine.getConfigDiagnostics().runs.at(-1)).toMatchObject({ kind: "hook", exitCode: 2 });
});

it("sends a hook's added context to the agent, and queues a TurnEnd follow-up once per turn", async () => {
  const f = await fixture();
  const context = f.script("context.sh", `echo '{"additionalContext": "House rule: use pnpm."}'\n`);
  const follow = f.script("follow.sh", `cat > "$CAPSULE_PROJECT_DIR/../turn.json"\necho '{"followUp": "Now run the tests."}'\n`);
  write(path.join(f.configDir, "settings.json"), JSON.stringify({ hooks: {
    PromptSubmit: [{ hooks: [{ type: "command", command: context }] }],
    TurnEnd: [{ hooks: [{ type: "command", command: follow }] }],
  } }));
  f.engine.reloadConfig();
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");
  const session = await f.thread();
  const { run } = await f.engine.sendMessage({ sessionId: session.id, content: "Add a route", mode: "chat", agentId: "general" });
  expect(sent.mock.calls.at(-1)?.[0].content).toContain("House rule: use pnpm.");
  expect(f.engine.listMessages(session.id).find((message) => message.role === "user")?.content).toBe("Add a route");
  await settled(f.engine, run.id);
  await vi.waitFor(() => expect(f.engine.listRunEvents(run.id).filter((event) => event.type === "hook.follow-up")).toHaveLength(1), { timeout: 8000 });
  expect(JSON.parse(readFileSync(path.join(f.profile, "turn.json"), "utf8"))).toMatchObject({ event: "TurnEnd", run: { status: "completed" } });
  const turnEnds = () => f.engine.getConfigDiagnostics().runs.filter((record) => record.label === "TurnEnd").length;
  const before = turnEnds();
  f.engine.listRuns(session.id);
  (f.engine as unknown as { events: { emit(name: string, run: Run): void } }).events.emit("run", f.engine.getRun(run.id)!);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(turnEnds()).toBe(before);
});

it("decides a direct agent's request by rule, and by a hook when no rule matches", async () => {
  const f = await fixture();
  const allow = f.script("allow.sh", `echo '{"permissionDecision": "allow", "reason": "Reads are fine here."}'\n`);
  write(path.join(f.configDir, "settings.json"), JSON.stringify({
    permissions: { allow: ["execute(pnpm test *)"], deny: ["execute(rm *)"] },
    hooks: { PermissionRequest: [{ matcher: "read", hooks: [{ type: "command", command: allow }] }] },
  }));
  f.engine.reloadConfig();
  const thread = await f.thread();
  const internal = f.engine as unknown as {
    usingMock: boolean;
    direct: DirectAcpHost;
    repos: { updateSession(session: Session): void; insertRun(run: Run): void };
    bindAcpReplies(): void;
  };
  const key = "direct:acp:grok:policy";
  thread.openclawSessionKey = key;
  internal.repos.updateSession(thread);
  const createdAt = new Date().toISOString();
  const run: Run = { id: "policy-run", projectId: f.project.id, sessionId: thread.id, agentId: "grok", prompt: "Work", status: "running", createdAt, updatedAt: createdAt };
  internal.repos.insertRun(run);
  internal.usingMock = false;
  internal.bindAcpReplies();
  const session = new DirectAcpSession({ command: "unused-fixture", args: [] });
  const responses = vi.spyOn(session as unknown as { respond(id: number | string, result: unknown): void }, "respond");
  const protocol = session as unknown as { acpSessionId: string; handle(message: unknown): void };
  protocol.acpSessionId = "fixture";
  const host = internal.direct as unknown as { sessions: Map<string, DirectAcpSession>; wire(key: string, session: DirectAcpSession): void };
  host.wire(key, session);
  host.sessions.set(key, session);
  const ask = (id: number, toolCall: Record<string, unknown>) => protocol.handle({
    jsonrpc: "2.0", id, method: "session/request_permission",
    params: { sessionId: "fixture", toolCall, options: [{ kind: "allow_once", optionId: "once" }, { kind: "reject_once", optionId: "deny" }] },
  });
  const answer = (id: number) => responses.mock.calls.find(([callId]) => callId === id)?.[1];

  ask(1, { kind: "execute", title: "Run tests", rawInput: { command: "pnpm test --run" } });
  ask(2, { kind: "execute", title: "Clean", rawInput: { command: ["bash", "-lc", "rm -rf dist"] } });
  ask(3, { kind: "read", title: "Read notes", locations: [{ path: path.join(f.root, "notes.md") }] });
  ask(4, { kind: "edit", title: "Edit a.ts", locations: [{ path: path.join(f.root, "a.ts") }] });
  await vi.waitFor(() => expect(answer(3)).toBeDefined(), { timeout: 8000 });
  expect(answer(1)).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  expect(answer(2)).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
  expect(answer(3)).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  await vi.waitFor(() => expect(f.engine.listApprovals("pending").map((item) => item.action)).toEqual(["Edit a.ts"]));
  expect(answer(4)).toBeUndefined();
  const audit = f.engine.listRunEvents(run.id).filter((event) => event.type === "approval.auto").map((event) => event.message);
  expect(audit).toEqual(expect.arrayContaining([
    expect.stringMatching(/^Allowed by execute\(pnpm test \*\)/),
    expect.stringMatching(/^Denied by execute\(rm \*\)/),
    expect.stringMatching(/^Allowed by a PermissionRequest hook in .*settings\.json: Reads are fine here\.$/),
  ]));
});

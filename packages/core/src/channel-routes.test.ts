import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SharedRelayClient, type RelayCommand } from "@capsule/buzz";
import { CapsuleEngine } from "./engine.js";
import { ChannelRoutes } from "./channel-routes.js";
import { PRESET_HARNESSES } from "@capsule/shared";
import * as harness from "@capsule/harness";

const channel = "11111111-2222-3333-4444-555555555555", author = "a".repeat(64);
const eventId = (n: number) => n.toString(16).padStart(64, "0");
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture(direct = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-route-"));
  const preset = PRESET_HARNESSES.find((item) => item.id === "codex")!;
  const original = preset.directCommand;
  if (direct) {
    preset.directCommand = { command: process.execPath, args: ["-e", `
      const readline = require('node:readline');
      const send = message => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...message})+'\\n');
      let turns = 0;
      readline.createInterface({input:process.stdin}).on('line', line => {
        const m = JSON.parse(line);
        if(m.method === 'initialize') send({id:m.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}}}}});
        else if(m.method === 'session/new') send({id:m.id,result:{sessionId:'channel-native'}});
        else if(m.method === 'session/resume') { turns = 1; send({id:m.id,result:{}}); }
        else if(m.method === 'session/prompt') {
          send({method:'session/update',params:{sessionId:'channel-native',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Native reply '+(++turns)}}}});
          send({id:m.id,result:{stopReason:'end_turn'}});
        } else if(m.id !== undefined) send({id:m.id,result:{}});
      });`] };
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
    vi.spyOn(harness, "whichBinary").mockImplementation((names) => names.includes(process.execPath) ? process.execPath : undefined);
  }
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: direct };
  let engine = new CapsuleEngine(options);
  await engine.start();
  const project = engine.createProject({ name: "Channel fixture", workingDirectory: directory });
  const messages: Array<{ id: string; pubkey: string; kind: number; content: string; created_at: number; tags: string[][] }> = [];
  const sent: Array<{ content: string; args: string[] }> = [];
  let joined = true, rejectPosts = false, identity = author;
  const command: RelayCommand = async (_credentials, args, _signal, content) => {
    if (args[0] === "users") return [{ pubkey: identity }];
    if (args[0] === "channels") return !joined && args.includes("--member") ? [] : [{ channel_id: channel, name: "Fixture" }];
    if (args[1] === "send") {
      sent.push({ content: content ?? "", args });
      if (rejectPosts) throw new Error("Timed out after delivery");
      const root = args.includes("--reply-to") ? args[args.indexOf("--reply-to") + 1] : undefined;
      return { accepted: true, event_id: add(content ?? "", identity, root) };
    }
    return messages;
  };
  const relay = new SharedRelayClient(command);
  await relay.connect({ url: "https://relay.example", privateKey: "b".repeat(64) });
  const store = { getSetting: (key: string) => engine.repos.getSetting(key), setSetting: (key: string, value: string) => engine.repos.setSetting(key, value) };
  let routes = new ChannelRoutes(relay, engine, store);
  disposals.push(async () => { relay.disconnect(); await routes.stop(); await engine.stop(); preset.directCommand = original; rmSync(directory, { recursive: true, force: true }); });
  function add(content: string, pubkey = author, root?: string) {
    const id = eventId(messages.length + 1);
    messages.push({ id, pubkey, kind: 9, content, created_at: Math.floor(Date.now() / 1000), tags: [["h", channel], ...(root ? [["e", root, "", "root"], ["e", root, "", "reply"]] : [])] });
    return id;
  }
  const input = { channelId: channel, projectId: project.id, harnessId: "codex" as const, enabled: true };
  async function finish() {
    await expect.poll(async () => { await routes.tick(); return (await routes.status(channel)).jobs[0]?.publication; }, { timeout: 6000 }).toBe("shared");
  }
  return { get engine() { return engine; }, relay, input, add, messages, sent, finish, get routes() { return routes; },
    restart: async () => { await routes.stop(); routes = new ChannelRoutes(relay, engine, store); },
    restartEngine: async () => { await routes.stop(); await engine.stop(); engine = new CapsuleEngine(options); await engine.start(); routes = new ChannelRoutes(relay, engine, store); },
    joined: (value: boolean) => { joined = value; }, reject: () => { rejectPosts = true; },
    reconnect: async (next = author) => { identity = next; await relay.connect({ url: "https://relay.example", privateKey: next }); },
  };
}

it("carries a channel turn through a spawned ACP process, then continues the same native session", async () => {
  const f = await fixture(true); await f.routes.configure(f.input);
  const root = f.add("@capsule First prompt"); await f.finish();
  const first = (await f.routes.status(channel)).jobs[0]!;
  expect(f.sent[0]?.content).toBe("Capsule · codex\n\nNative reply 1");
  expect(f.engine.listSessions(f.input.projectId)[0]?.openclawSessionKey).toMatch(/^direct:acp:codex:/);
  await f.restartEngine();
  f.add("@capsule Continue", author, root); await f.finish();
  expect(f.sent[1]?.content).toBe("Capsule · codex\n\nNative reply 2");
  expect((await f.routes.status(channel)).jobs[0]?.sessionId).toBe(first.sessionId);
});

it("routes a normal channel send through a real workspace run and automatically publishes to its thread", async () => {
  const f = await fixture();
  const historical = f.add("@capsule Do not replay old work");
  await f.routes.configure(f.input);
  const root = await f.relay.post({ channelId: channel, content: "@capsule Review this project", mentions: [] });
  await f.finish();
  const job = (await f.routes.status(channel)).jobs[0]!;
  expect(job.messageId).toBe(root); expect(job.messageId).not.toBe(historical);
  expect(f.engine.getRun(job.runId!)?.prompt).toBe("Review this project");
  expect(f.engine.listSessions(f.input.projectId)[0]).toMatchObject({ permissionProfile: "strict", workspaceMode: "local", harnessId: "codex" });
  expect(f.sent).toHaveLength(2);
  expect(f.sent[1]!.args).toContain(root);
  expect(f.sent[1]!.content).toMatch(/^Capsule · codex\n\n/);
  expect(f.sent[1]!.args).not.toContain("--mention");
  await Promise.all([f.routes.tick(), f.routes.tick(), f.routes.tick()]);
  expect(f.sent).toHaveLength(2);
  expect(f.engine.listRuns(job.sessionId)).toHaveLength(1);
});

it("reuses a thread conversation after restart without replaying execution or replying to itself", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  const root = f.add("@capsule First turn"); await f.finish();
  const first = (await f.routes.status(channel)).jobs[0]!;
  await f.restart();
  expect((await f.routes.status(channel)).configuration?.enabled).toBe(true);
  f.add("@capsule Continue this thread", author, root); await f.finish();
  const second = (await f.routes.status(channel)).jobs[0]!;
  expect(second.sessionId).toBe(first.sessionId);
  expect(f.engine.listRuns(first.sessionId)).toHaveLength(2);
  expect(f.sent).toHaveLength(2);
  f.add("@capsule A different root"); await f.finish();
  expect((await f.routes.status(channel)).jobs[0]!.sessionId).not.toBe(first.sessionId);
});

it("ignores untrusted senders, ordinary chat, old messages and the reserved mention without a prompt", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  f.add("@capsule Read secrets", "c".repeat(64)); f.add("Hello"); f.add("@capsule"); f.add("Discuss @capsule please");
  f.add("@capsule Old"); f.messages.at(-1)!.created_at = 1;
  await f.routes.tick();
  expect((await f.routes.status(channel)).jobs).toEqual([]); expect(f.sent).toEqual([]);
});

it("pauses on agent errors with an inspectable conversation rather than silently losing the reply", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  vi.spyOn(f.engine, "sendMessage").mockRejectedValue(new Error("Model unavailable for this account"));
  f.add("@capsule Hello"); await f.routes.tick();
  const state = await f.routes.status(channel);
  expect(state.configuration?.enabled).toBe(false);
  expect(state.error).toContain("Model unavailable");
  expect(state.jobs[0]?.sessionId).toBeTruthy(); expect(f.sent).toEqual([]);
});

it("never retries an uncertain reply, even after reconnect and restart", async () => {
  const f = await fixture(); await f.routes.configure(f.input); f.reject();
  f.add("@capsule Hi");
  await expect.poll(async () => { await f.routes.tick(); return (await f.routes.status(channel)).jobs[0]?.publication; }, { timeout: 6000 }).toBe("uncertain");
  await f.restart(); await f.reconnect(); await f.routes.tick(); await f.routes.tick();
  expect(f.sent).toHaveLength(1);
  expect((await f.routes.status(channel)).jobs[0]?.publication).toBe("uncertain");
});

it("keeps bindings private to one relay identity and refuses membership loss", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  await f.reconnect("c".repeat(64)); f.add("@capsule Do not execute", "c".repeat(64)); await f.routes.tick();
  expect((await f.routes.status(channel)).configuration).toBeUndefined(); expect(f.sent).toEqual([]);
  await f.reconnect(); f.joined(false); f.add("@capsule Not joined"); await f.routes.tick();
  expect((await f.routes.status(channel)).error).toContain("membership changed"); expect(f.sent).toEqual([]);
});

it("pausing prevents automatic publication but retains the local run for inspection", async () => {
  const f = await fixture(); await f.routes.configure(f.input); f.add("@capsule Hi"); await f.routes.tick();
  const job = (await f.routes.status(channel)).jobs[0]!;
  await f.routes.configure({ ...f.input, enabled: false });
  await expect.poll(() => f.engine.getRun(job.runId!)?.status, { timeout: 6000 }).toBe("completed");
  await f.routes.tick();
  expect(f.sent).toEqual([]); expect((await f.routes.status(channel)).jobs[0]?.error).toContain("paused");
});

it("retains an approval wait and serializes a follow-up until the first run settles", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  const root = f.add("@capsule [approval]"); f.add("@capsule Later", author, root); await f.routes.tick();
  const state = await f.routes.status(channel);
  expect(state.jobs).toHaveLength(2);
  expect(state.jobs[0]?.status).toBe("queued");
  expect(state.jobs[1]?.sessionId).toBeTruthy();
  expect(f.engine.listSessions(f.input.projectId)).toHaveLength(1);
  expect(f.sent).toEqual([]);
});

it("fails closed if durable admission cannot be written", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  vi.spyOn(f.engine.repos, "setSetting").mockImplementation(() => { throw new Error("Disk full"); });
  f.add("@capsule Must not execute without a ledger"); await f.routes.tick(); await f.routes.tick();
  expect((await f.routes.status(channel)).error).toContain("could not be saved");
  expect(f.engine.listSessions(f.input.projectId)).toHaveLength(0);
  expect(f.sent).toEqual([]);
});

it("does not launch a prompt when paused while conversation creation is in flight", async () => {
  const f = await fixture(); await f.routes.configure(f.input);
  const create = f.engine.createSession.bind(f.engine);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(f.engine, "createSession").mockImplementation(async (input) => { await gate; return create(input); });
  const send = vi.spyOn(f.engine, "sendMessage");
  f.add("@capsule Paused admission"); const pending = f.routes.tick();
  await expect.poll(async () => (await f.routes.status(channel)).jobs[0]?.status).toBe("starting");
  await f.routes.configure({ ...f.input, enabled: false }); release(); await pending;
  expect(send).not.toHaveBeenCalled(); expect(f.sent).toEqual([]);
});

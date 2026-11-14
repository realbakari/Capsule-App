import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CapsuleEngine } from "@capsule/core";
import { ShareGrantStore } from "@capsule/database";
import { startRemoteServer, type RemoteServerHandle } from "@capsule/remote";
import { aggregatePresence, IPC_EVENTS, type Project, type Run, type Session } from "@capsule/shared";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerShareHandlers, remoteShareOptions, type ShareContext } from "./share-ipc";
import { SHARE_REFUSAL } from "./share-scope";

/*
 * A share link against the real server and a real engine: the link reads its
 * own thread, is refused everything else, and stops working the moment it is
 * revoked or expires.
 */

let engine: CapsuleEngine;
let server: RemoteServerHandle;
let store: ShareGrantStore;
let shared: Session;
let other: Session;
let sharedRun: Run;
let otherRun: Run;
const emitters = new Set<(event: string, payload: unknown) => void>();

const HANDLERS: Record<string, (args: unknown[]) => unknown> = {
  listMessages: ([id]) => engine.listMessages(String(id)),
  listMessagePage: ([id, options]) => engine.listMessagePage(String(id), options as never),
  listRunPage: ([query]) => engine.listRunPage(query as never),
  getRun: ([id]) => engine.getRun(String(id)),
  listRunEvents: ([id]) => engine.listRunEvents(String(id)),
  listSessions: () => engine.listSessions(),
  listProjects: () => engine.listProjects(),
  getSettings: () => engine.getSettings(),
};

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-share-flow-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Capsule</title>");
  engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  const project: Project = engine.createProject({ name: "Shared workspace", defaultMode: "code", workingDirectory: dir });
  shared = await engine.createSession({ projectId: project.id, agentId: "coding", mode: "code", title: "Shared thread" });
  other = await engine.createSession({ projectId: project.id, agentId: "coding", mode: "code", title: "Private thread" });
  sharedRun = (await engine.sendMessage({ sessionId: shared.id, content: "Explain the build", agentId: "coding", mode: "code" })).run;
  otherRun = (await engine.sendMessage({ sessionId: other.id, content: "Secret plan", agentId: "coding", mode: "code" })).run;
  await vi.waitFor(() => {
    expect(engine.getRun(sharedRun.id)?.status).toBe("completed");
    expect(engine.getRun(otherRun.id)?.status).toBe("completed");
  }, { timeout: 8000 });
  store = new ShareGrantStore(engine.db);
  const ctx: ShareContext = {
    engine: () => engine,
    remote: () => server,
    call: async (channel, args) => {
      const handler = HANDLERS[channel];
      if (!handler) throw new Error(`Unexpected handler ${channel}`);
      return handler(args);
    },
    changed: () => {},
    saveDialog: async () => undefined,
  };
  server = await startRemoteServer({
    serveDir: dir, reach: "loopback",
    invoke: async (channel, args) => HANDLERS[channel]!(args),
    subscribe: (emit) => { emitters.add(emit); return () => { emitters.delete(emit); }; },
    ...remoteShareOptions(ctx),
  });
}, 20_000);

afterAll(async () => {
  await server?.stop();
  await engine?.stop();
});

interface Frame { type?: string; id?: number; result?: unknown; error?: string; event?: string; payload?: unknown; share?: { sessionId: string } }

async function connect(first: Record<string, unknown>) {
  const origin = `http://127.0.0.1:${server.port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, { origin });
  const frames: Frame[] = [];
  let closed: number | undefined;
  socket.on("message", (raw) => frames.push(JSON.parse(String(raw)) as Frame));
  socket.on("close", (code) => { closed = code; });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify(first));
  let id = 0;
  const call = async (channel: string, args: unknown[] = []) => {
    const requestId = ++id;
    socket.send(JSON.stringify({ id: requestId, channel, args }));
    await vi.waitFor(() => expect(frames.some((frame) => frame.id === requestId)).toBe(true));
    return frames.find((frame) => frame.id === requestId)!;
  };
  return { socket, frames, call, closed: () => closed };
}

describe("share links", () => {
  it("reads only its own thread, with nothing that locates it on disk", async () => {
    const { token } = store.create({ sessionId: shared.id });
    const viewer = await connect({ share: token });
    try {
      await vi.waitFor(() => expect(viewer.frames[0]).toMatchObject({ type: "ready", scopes: ["read"], share: { sessionId: shared.id } }));
      const sessions = (await viewer.call("listSessions")).result as Session[];
      expect(sessions.map((session) => session.id)).toEqual([shared.id]);
      const projects = (await viewer.call("listProjects")).result as Project[];
      expect(projects).toHaveLength(1);
      expect(projects[0]!.workingDirectory).toBeUndefined();
      const messages = (await viewer.call("listMessages", [shared.id])).result as Array<{ content: string }>;
      expect(messages.some((message) => message.content === "Explain the build")).toBe(true);
      const run = (await viewer.call("getRun", [sharedRun.id])).result as Run;
      expect(run.id).toBe(sharedRun.id);
      expect(run.workingDirectory).toBeUndefined();
      const page = (await viewer.call("listRunPage", [{ sessionId: shared.id }])).result as { runs: Run[] };
      expect(page.runs.map((item) => item.id)).toEqual([sharedRun.id]);
      await engine.updateSettings({ worktreesDirectory: "/private/worktrees-of-someone", appearanceTheme: "dark" });
      const settings = JSON.stringify((await viewer.call("getSettings")).result);
      expect(settings).not.toContain("worktrees-of-someone");
      expect(settings).toContain('"appearanceTheme":"dark"');
    } finally {
      viewer.socket.terminate();
    }
  });

  it("refuses another thread, another thread's turns, and every other channel", async () => {
    const { token } = store.create({ sessionId: shared.id });
    const viewer = await connect({ share: token });
    try {
      await vi.waitFor(() => expect(viewer.frames[0]?.type).toBe("ready"));
      expect((await viewer.call("listMessages", [other.id])).error).toBe(SHARE_REFUSAL);
      expect((await viewer.call("listMessagePage", [other.id, { limit: 10 }])).error).toBe(SHARE_REFUSAL);
      expect((await viewer.call("listRunPage", [{}])).error).toBe(SHARE_REFUSAL);
      expect((await viewer.call("listRunPage", [{ sessionId: other.id }])).error).toBe(SHARE_REFUSAL);
      expect((await viewer.call("getRun", [otherRun.id])).error).toBe(SHARE_REFUSAL);
      expect((await viewer.call("listRunEvents", [otherRun.id])).error).toBe(SHARE_REFUSAL);
      for (const channel of ["listFiles", "readFile", "gitDiff", "search", "remoteStatus", "updateSettings", "sendMessage", "listShareLinks", "threadPresence", "constructor"]) {
        expect((await viewer.call(channel, [shared.id])).error).toBe(SHARE_REFUSAL);
      }
    } finally {
      viewer.socket.terminate();
    }
  });

  it("forwards only its own thread's live events", async () => {
    const { token } = store.create({ sessionId: shared.id });
    const viewer = await connect({ share: token });
    try {
      await vi.waitFor(() => expect(viewer.frames[0]?.type).toBe("ready"));
      for (const emit of emitters) {
        emit(IPC_EVENTS.message, { id: "m-other", sessionId: other.id, content: "Secret" });
        emit(IPC_EVENTS.run, { id: "e-other", runId: otherRun.id, type: "tool" });
        emit(IPC_EVENTS.state, { command: "remote-updated" });
        emit(IPC_EVENTS.message, { id: "m-shared", sessionId: shared.id, content: "Hello" });
      }
      await vi.waitFor(() => expect(viewer.frames.some((frame) => frame.type === "event")).toBe(true));
      const events = viewer.frames.filter((frame) => frame.type === "event");
      expect(events.map((frame) => (frame.payload as { id: string }).id)).toEqual(["m-shared"]);
    } finally {
      viewer.socket.terminate();
    }
  });

  it("disconnects an open viewer when its link is revoked, and refuses it after", async () => {
    const { grant, token } = store.create({ sessionId: shared.id });
    const viewer = await connect({ share: token });
    await vi.waitFor(() => expect(viewer.frames[0]?.type).toBe("ready"));
    expect(server.viewers().filter((item) => item.access === "share").length).toBeGreaterThan(0);
    store.revoke(grant.id);
    server.revokeShare(grant.id);
    await vi.waitFor(() => expect(viewer.closed()).toBe(4401));
    const again = await connect({ share: token });
    await vi.waitFor(() => expect(again.closed()).toBe(4401));
    expect(again.frames).toEqual([]);
  });

  it("refuses a call the moment a link is revoked, even before the socket closes", async () => {
    const { grant, token } = store.create({ sessionId: shared.id });
    const viewer = await connect({ share: token });
    await vi.waitFor(() => expect(viewer.frames[0]?.type).toBe("ready"));
    store.revoke(grant.id);
    viewer.socket.send(JSON.stringify({ id: 99, channel: "listMessages", args: [shared.id] }));
    await vi.waitFor(() => expect(viewer.closed()).toBe(4401));
    expect(viewer.frames.some((frame) => frame.id === 99)).toBe(false);
  });

  it("refuses an expired link", async () => {
    const { token } = store.create({ sessionId: shared.id, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const viewer = await connect({ share: token });
    await vi.waitFor(() => expect(viewer.closed()).toBe(4401));
    expect(viewer.frames).toEqual([]);
  });
});

describe("presence", () => {
  it("knows which thread each viewer is reading", async () => {
    const { token } = store.create({ sessionId: shared.id });
    const linkViewer = await connect({ share: token });
    const pairing = server.pair(["read"]).split("#pair=")[1];
    const origin = `http://127.0.0.1:${server.port}`;
    const response = await fetch(`${origin}/pair`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ token: pairing, label: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }) });
    const paired = await connect({ token: ((await response.json()) as { token: string }).token });
    try {
      await vi.waitFor(() => expect(paired.frames[0]?.type).toBe("ready"));
      await paired.call("listMessagePage", [other.id, { limit: 10 }]);
      const presence = aggregatePresence(server.viewers());
      expect(presence.find((item) => item.sessionId === other.id)?.viewers).toEqual([expect.objectContaining({ kind: "phone", label: "iPhone" })]);
      expect(presence.find((item) => item.sessionId === shared.id)?.viewers).toEqual([expect.objectContaining({ kind: "share-link" })]);
    } finally {
      linkViewer.socket.terminate();
      paired.socket.terminate();
    }
    await vi.waitFor(() => expect(server.viewers()).toEqual([]));
  });
});

describe("export", () => {
  it("writes the thread as Markdown where the save dialog says, and writes nothing when it is cancelled", async () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), "capsule-export-")), "thread.md");
    let answer: string | undefined = target;
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const names = { threadMarkdown: "md", exportThreadMarkdown: "export", createShareLink: "create", listShareLinks: "list", revokeShareLink: "revoke", threadPresence: "presence" };
    registerShareHandlers((channel, fn) => handlers.set(channel, fn), names, {
      engine: () => engine, remote: () => server, call: async () => undefined, changed: () => {},
      saveDialog: async (name) => { expect(name).toBe("Shared thread.md"); return answer; },
    });
    expect(await handlers.get("export")!(shared.id, { includeToolActivity: true })).toEqual({ saved: true, path: target });
    const markdown = readFileSync(target, "utf8");
    expect(markdown).toMatch(/^# Shared thread\n/u);
    expect(markdown).toContain("> Explain the build");
    expect(markdown).not.toContain("Secret plan");
    answer = undefined;
    expect(await handlers.get("export")!(shared.id, {})).toEqual({ saved: false });
    const created = await handlers.get("create")!(shared.id, "1h") as { url: string };
    expect(created.url).toMatch(/#share=[\w-]{20,}$/u);
    await expect(Promise.resolve().then(() => handlers.get("create")!(shared.id, "forever"))).rejects.toThrow("how long");
  });
});

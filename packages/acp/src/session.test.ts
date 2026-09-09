import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { DirectAcpSession, MAX_CACHED_TOOL_TITLES } from "./session.js";
import { DirectAcpHost } from "./host.js";

/*
 * A stand-in agent, so the client is exercised end to end without needing a
 * signed-in CLI. It speaks the same protocol a real one does: JSON-RPC lines
 * on stdin and stdout, an initialize handshake, a session, and a turn that
 * streams before it finishes.
 */
function fakeAgent(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "acp-agent-"));
  const file = path.join(dir, "agent.mjs");
  writeFileSync(
    file,
    `let buffered = "";
     const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
     process.stdin.on("data", (chunk) => {
       buffered += chunk.toString();
       const parts = buffered.split("\\n");
       buffered = parts.pop() ?? "";
       for (const line of parts) {
         if (!line.trim()) continue;
         const message = JSON.parse(line);
         handle(message);
       }
     });
     ${body}
    `,
  );
  return file;
}

const HAPPY = `
  function handle(message) {
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
      return;
    }
    if (message.method === "session/new") {
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "sess-1" } });
      return;
    }
    if (message.method === "session/prompt") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read README.md", status: "in_progress" } } });
      send({ method: "session/update", params: { sessionId: "other-session",
        update: { sessionUpdate: "tool_call", title: "Wrong session" } } });
      send({ method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } } } });
      send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    }
  }
`;

describe("talking to an agent directly", () => {
  it("bounds retained tool titles by both count and payload size", () => {
    const session = new DirectAcpSession({ command: "unused", args: [] });
    const internal = session as unknown as { handle(message: unknown): void; toolTitles: Map<string, string> };
    for (let i = 0; i < 600; i++) internal.handle({ method: "session/update", params: { update: {
      sessionUpdate: "tool_call", toolCallId: `tool-${i}`, title: "界".repeat(64_000),
    } } });
    expect(internal.toolTitles.size).toBe(MAX_CACHED_TOOL_TITLES);
    const bytes = [...internal.toolTitles].reduce((total, [id, title]) => total + Buffer.byteLength(id) + Buffer.byteLength(title), 0);
    expect(bytes).toBeLessThan(768 * 1024);
    expect(internal.toolTitles.has("tool-599")).toBe(true);
    expect(internal.toolTitles.has("tool-0")).toBe(false);
  });
  it("settles a pending prompt and closes its child after an asynchronous input-pipe error", async () => {
    const agent = fakeAgent(HAPPY.replace('if (message.method === "session/prompt") {', 'if (message.method === "session/prompt") { return;'));
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try {
      await session.start();
      const prompt = session.prompt("Wait for a reply");
      const rejected = expect(prompt).rejects.toThrow("agent input pipe failed: write EPIPE");
      const child = (session as unknown as { child: import("node:child_process").ChildProcessWithoutNullStreams }).child;
      child.stdin.emit("error", new Error("write EPIPE"));
      await rejected;
      await Promise.all([session.close(), session.close()]);
      expect(session.running).toBe(false);
      await expect(session.prompt("Do not hang")).rejects.toThrow("not running");
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it("retains acknowledged configuration on rejection and ignores an older response after a notification", async () => {
    const options = (value: string) => [{ id: "model-id", category: "model", name: "Model", type: "select", currentValue: value,
      options: ["one", "two"].map((value) => ({ value, name: value })) }];
    const agent = fakeAgent(`let calls = 0;
      function handle(message) {
        if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1 } });
        if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s", configOptions: ${JSON.stringify(options("one"))} } });
        if (message.method === "session/set_config_option") {
          if (++calls === 1) { send({ id: message.id, error: { code: -32000, message: "Change rejected" } }); return; }
          send({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "config_option_update", configOptions: ${JSON.stringify(options("two"))} } } });
          setTimeout(() => send({ id: message.id, result: { configOptions: ${JSON.stringify(options("one"))} } }), 20);
        }
      }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try {
      await session.start();
      await expect(session.setConfig("model-id", "two")).rejects.toThrow("Change rejected");
      expect(session.models?.currentModelId).toBe("one");
      const setting = session.setConfig("model-id", "two");
      await expect(session.setConfig("model-id", "one")).rejects.toThrow("still being applied");
      await setting;
      expect(session.models?.currentModelId).toBe("two");
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("surfaces a rejected resume without replacing the saved session", async () => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } });
      if (message.method === "session/resume") send({ id: message.id, error: { code: -32000, message: "Saved session expired" } });
      if (message.method === "session/new") throw new Error("Unexpected replacement");
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try { await expect(session.start("saved")).rejects.toThrow("Saved session expired"); }
    finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it.each(["resume", "load"])("restores a saved native session using advertised %s without replaying old work", async (method) => {
    const capability = method === "resume" ? { sessionCapabilities: { resume: {} } } : { loadSession: true };
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: ${JSON.stringify(capability)} } });
      if (message.method === "session/${method}") {
        if (message.params.sessionId !== "saved-id" || !message.params.cwd || !Array.isArray(message.params.mcpServers)) throw new Error("Lost restore identity");
        send({ method: "session/update", params: { sessionId: "saved-id", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old history" } } } });
        send({ method: "session/request_permission", id: "old-approval", params: { sessionId: "saved-id", toolCall: { title: "Old approval" }, options: [{ optionId: "yes", kind: "allow_once" }] } });
        send({ id: message.id, result: {} });
      }
      if (message.method === "session/new") throw new Error("Must not replace the saved session");
      if (message.method === "session/prompt") {
        send({ method: "session/update", params: { sessionId: "saved-id", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "new answer" } } } });
        send({ id: message.id, result: { stopReason: "end_turn" } });
      }
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent], cwd: path.dirname(agent) });
    const text = vi.fn(); const approval = vi.fn(); session.on("text", text); session.on("permission", approval);
    try {
      expect(await session.start("saved-id")).toBe("saved-id");
      expect(text).not.toHaveBeenCalled(); expect(approval).not.toHaveBeenCalled();
      await session.prompt("Continue");
      expect(text).toHaveBeenCalledExactlyOnceWith({ text: "new answer", thought: false });
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("does not silently create a fresh session when resume is unsupported", async () => {
    const agent = fakeAgent(HAPPY);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try { await expect(session.start("saved-id")).rejects.toThrow("cannot resume"); }
    finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("carries native content and acknowledged live select/boolean configuration", async () => {
    const agent = fakeAgent(`
      let configOptions = [
        { id: "selected_model", category: "model", name: "Model", type: "select", currentValue: "small", options: [{ value: "small" }, { value: "large" }] },
        { id: "careful", name: "Careful", type: "boolean", currentValue: false }
      ];
      function handle(message) {
        if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } } } });
        if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s", configOptions } });
        if (message.method === "session/set_config_option") {
          const option = configOptions.find(item => item.id === message.params.configId);
          if (option.type === "boolean" && message.params.type !== "boolean") throw new Error("Missing boolean discriminant");
          option.currentValue = message.params.value;
          send({ id: message.id, result: { configOptions } });
        }
        if (message.method === "session/prompt") {
          send({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(message.params.prompt) } } } });
          send({ id: message.id, result: { stopReason: "end_turn" } });
        }
      }
    `);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const text = vi.fn(); session.on("text", text);
    try {
      await session.start();
      await session.setConfig("selected_model", "large");
      expect(session.models?.currentModelId).toBe("large");
      await session.setConfig("careful", true);
      expect(session.reportedCapabilities?.configOptions[1]?.booleanValue).toBe(true);
      await expect(session.setConfig("selected_model", "invented")).rejects.toThrow("reported");
      await expect(session.setConfig("careful", "true")).rejects.toThrow("reported");
      const blocks = [{ type: "text" as const, text: "Inspect" }, { type: "image" as const, mimeType: "image/png", data: "cG5n" },
        { type: "resource" as const, resource: { uri: "file:///fixture.pdf", mimeType: "application/pdf", blob: "cGRm" } }];
      await session.prompt(blocks);
      expect(JSON.parse(text.mock.calls[0]![0].text)).toEqual(blocks);
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it.each([2, 0, "1", undefined, null])("rejects negotiated protocol version %s before opening a session", async (version) => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: ${JSON.stringify({ protocolVersion: version })} });
      if (message.method === "session/new") send({ id: message.id, result: { sessionId: "must-not-open" } });
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const request = vi.spyOn(session as unknown as { request(method: string, params: unknown): Promise<unknown> }, "request");
    try {
      await expect(session.start()).rejects.toThrow(/ACP protocol version/);
      expect(request).toHaveBeenCalledTimes(1);
      expect(session.sessionId).toBeUndefined();
    } finally { request.mockRestore(); await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it.each([true, false, undefined, "true"])("forwards HTTP MCP only for advertised boolean support (%s)", async (http) => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: ${JSON.stringify({ http })} } } });
      if (message.method === "session/new") send({ id: message.id, result: { sessionId: JSON.stringify(message.params.mcpServers) } });
      if (message.method === "session/prompt") send({ id: message.id, result: { stopReason: "end_turn" } });
    }`);
    const servers = [
      { type: "http" as const, name: "fixture-tools", url: "http://127.0.0.1:1/mcp", headers: [{ name: "Authorization", value: "fixture-only" }] },
      { type: "http" as const, name: "fixture-public", url: "http://127.0.0.1:1/public" },
    ];
    const session = new DirectAcpSession({ command: "node", args: [agent], mcpServers: servers });
    try {
      expect(JSON.parse(await session.start())).toEqual(http === true ? servers.map((server) => ({ ...server, headers: server.headers ?? [] })) : []);
      expect(session.reportedCapabilities?.httpMcp).toBe(typeof http === "boolean" ? http : undefined);
      // Missing optional browser transport must not disable an ordinary turn.
      expect(await session.prompt("Hello")).toEqual({ stopReason: "end_turn" });
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("settles an approval once even when a later request reuses its ID", async () => {
    const session = new DirectAcpSession({ command: "unused-fixture", args: [] });
    const protocol = session as unknown as {
      acpSessionId: string;
      handle(message: unknown): void;
      respond(id: number, result: unknown): void;
    };
    protocol.acpSessionId = "s";
    const responses = vi.spyOn(protocol, "respond");
    const requests: Array<{ allow(): void; deny(): void; cancel(): void }> = [];
    session.on("permission", (request) => requests.push(request));
    const ask = () => protocol.handle({ jsonrpc: "2.0", method: "session/request_permission", id: 99, params: {
      sessionId: "s", toolCall: { title: "Write fixture" }, options: [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }],
    } });
    try {
      ask();
      requests[0]!.cancel();
      ask();
      requests[0]!.allow();
      requests[0]!.deny();
      expect(responses).toHaveBeenCalledOnce();
      requests[1]!.deny();
      expect(responses.mock.calls).toEqual([
        [99, { outcome: { outcome: "cancelled" } }],
        [99, { outcome: { outcome: "selected", optionId: "no" } }],
      ]);
    } finally { responses.mockRestore(); await session.close(); }
  });

  it.each([false, true])("replaces model snapshots and preserves only a real legacy fallback (%s)", async (hasLegacy) => {
    const legacy = { currentModelId: "legacy", availableModels: [{ modelId: "legacy", name: "Legacy model" }] };
    const agent = fakeAgent(`
      const model = (value) => [{ id: "choice", category: "model", type: "select", currentValue: value,
        options: [{ group: "available", name: "Available", options: [{ value, name: value }] }] }];
      function handle(message) {
        if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1 } });
        if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s", models: ${JSON.stringify(hasLegacy ? legacy : null)}, configOptions: model("first") } });
        if (message.method === "session/prompt") {
          const action = message.params.prompt[0].text;
          send({ method: "session/update", params: {
            sessionId: action === "foreign" ? "another-session" : "s",
            update: { sessionUpdate: "config_option_update", configOptions: action === "replace" ? model("second") : [] }
          } });
          send({ id: message.id, result: { stopReason: "end_turn" } });
        }
      }
    `);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const host = new DirectAcpHost();
    const key = "direct:acp:grok:configuration-fixture";
    (host as unknown as { sessions: Map<string, DirectAcpSession> }).sessions.set(key, session);
    try {
      await session.start();
      expect((await host.statusAcp(key)).parsed.model).toBe("first");
      await session.prompt("foreign");
      expect(session.models?.currentModelId).toBe("first");
      await session.prompt("replace");
      expect((await host.statusAcp(key)).parsed.models?.availableModels).toEqual([{ modelId: "second", name: "second" }]);
      await session.prompt("remove");
      const status = (await host.statusAcp(key)).parsed;
      expect(status.configOptions).toEqual([]);
      expect(status.models).toEqual(hasLegacy ? legacy : undefined);
      expect(status.model).toBe(hasLegacy ? "legacy" : undefined);
    } finally { await host.closeAll(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("negotiates config-only model reports and accepts usage only for this session", async () => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: "Fixture" }, agentCapabilities: { promptCapabilities: { image: true } } } });
      if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s", configOptions: [{ id: "choice", category: "model", type: "select", currentValue: "fixture", options: [{ value: "fixture", name: "Fixture model" }] }] } });
      if (message.method === "session/prompt") {
        for (const sessionId of ["wrong", "s", "s"]) send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "usage_update", used: 20, size: 100 } } });
        send({ id: message.id, result: { stopReason: "end_turn", usage: { inputTokens: 4, outputTokens: 2 } } });
      }
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const usage: unknown[] = [];
    session.on("usage", (report) => usage.push(report));
    try {
      await session.start();
      expect(session.reportedCapabilities).toMatchObject({ name: "Fixture", images: true });
      expect(session.models?.availableModels).toEqual([{ modelId: "fixture", name: "Fixture model" }]);
      await session.prompt("Fixture");
      expect(usage).toEqual([
        { context: { source: "agent", used: 20, size: 100 } },
        { turn: { source: "agent", inputTokens: 4, outputTokens: 2 } },
      ]);
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("flushes identified messages at prompt completion and starts the next turn cleanly", async () => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1 } });
      if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s" } });
      if (message.method === "session/prompt") {
        for (const [messageId, text] of [["progress", "Checking."], ["answer", "All "], ["answer", "done."]]) {
          send({ method: "session/update", params: { sessionId: "s", update: {
            sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text }
          } } });
        }
        send({ id: message.id, result: { stopReason: "end_turn" } });
      }
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const messages: string[] = [];
    let current = "";
    session.on("text", ({ text }) => { current += text; });
    session.on("message-end", () => { messages.push(current); current = ""; });
    try {
      await session.start();
      await session.prompt("First");
      await session.prompt("Second");
      expect(messages).toEqual(["Checking.", "All done.", "Checking.", "All done."]);
      expect(current).toBe("");
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it("rejects an oversized unterminated frame without waiting for a newline", async () => {
    const agent = fakeAgent(`function handle() { process.stdout.write("x".repeat(4 * 1024 * 1024 + 1)); }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try {
      await expect(session.start()).rejects.toThrow(/oversized|invalid/i);
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });

  it("preserves a UTF-8 character split across stdout chunks", async () => {
    const agent = fakeAgent(`function handle(message) {
      if (message.method === "initialize") { send({ id: message.id, result: { protocolVersion: 1 } }); return; }
      const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "🐈" } }) + "\\n");
      const cut = bytes.indexOf(Buffer.from("🐈")) + 2;
      process.stdout.write(bytes.subarray(0, cut));
      setTimeout(() => process.stdout.write(bytes.subarray(cut)), 25);
    }`);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    try { expect(await session.start()).toBe("🐈"); }
    finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it("rejects overlapping prompts and waits for cancellation to finish the active prompt", async () => {
    const agent = fakeAgent(`
      let turn;
      const responses = [];
      function handle(message) {
        if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1 } });
        if (message.method === "session/new") send({ id: message.id, result: { sessionId: "s" } });
        if (message.method === "session/prompt") {
          turn = message.id;
          send({ method: "session/request_permission", id: 99, params: { sessionId: "s", toolCall: { title: "Waiting" }, options: [{ optionId: "no", kind: "reject_once" }] } });
        }
        if (message.method === "session/cancel") {
          send({ method: "session/request_permission", id: 100, params: { sessionId: "s", toolCall: { title: "Late request" }, options: [{ optionId: "no", kind: "reject_once" }] } });
        }
        if (message.result && [99, 100].includes(message.id)) {
          responses.push(message.result.outcome);
          if (message.id === 100) {
            send({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(responses) } } } });
            send({ id: turn, result: { stopReason: "cancelled" } });
          }
        }
      }
    `);
    const session = new DirectAcpSession({ command: "node", args: [agent] });
    const chunks: string[] = [];
    session.on("text", ({ text }) => chunks.push(text));
    try {
      await session.start();
      let allow!: () => void;
      const permission = new Promise<void>((resolve) => session.on("permission", (request) => { allow = request.allow; resolve(); }));
      const turn = session.prompt("First");
      await permission;
      await expect(session.prompt("Overlap")).rejects.toThrow("active turn");
      const cancel = session.cancel();
      expect(session.busy).toBe(true);
      await cancel;
      expect((await turn).stopReason).toBe("cancelled");
      expect(session.busy).toBe(false);
      expect(JSON.parse(chunks.join(""))).toEqual([{ outcome: "cancelled" }, { outcome: "cancelled" }]);
      expect(() => { allow(); allow(); }).not.toThrow();
    } finally { await session.close(); rmSync(path.dirname(agent), { recursive: true, force: true }); }
  });
  it("keeps a whitespace-containing cwd intact in both process spawn and session/new", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "capsule working folder-"));
    const agent = fakeAgent(`
      function handle(message) {
        if (message.method === "initialize") {
          send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
        } else if (message.method === "session/new") {
          send({ jsonrpc: "2.0", id: message.id, result: {
            sessionId: JSON.stringify({ cwd: process.cwd(), received: message.params.cwd })
          } });
        }
      }
    `);
    const session = new DirectAcpSession({ command: "node", args: [agent], cwd });
    try {
      const opened = JSON.parse(await session.start()) as { cwd: string; received: string };
      expect(realpathSync(opened.cwd)).toBe(realpathSync(cwd));
      expect(opened.received).toBe(cwd);
    } finally {
      await session.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(path.dirname(agent), { recursive: true, force: true });
    }
  });

  it("handshakes, opens a session, and streams a turn", async () => {
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(HAPPY)] });
    const text: string[] = [];
    const thoughts: string[] = [];
    const tools: Array<{ title: string; status?: string; toolCallId?: string }> = [];
    session.on("text", ({ text: chunk, thought }) =>
      (thought ? thoughts : text).push(chunk),
    );
    session.on("tool", (tool) => tools.push(tool));

    expect(await session.start()).toBe("sess-1");
    const { stopReason } = await session.prompt("hi");

    expect(text.join("")).toBe("Hello world");
    // Reasoning arrives separately from the answer, and stays separate.
    expect(thoughts).toEqual(["thinking"]);
    expect(tools).toEqual([
      { toolCallId: "read-1", title: "Read README.md", status: "in_progress" },
      { toolCallId: "read-1", title: "Read README.md", status: "completed" },
    ]);
    expect(stopReason).toBe("end_turn");
    await session.close();
  });

  it("carries a message split across two writes", async () => {
    // A write can land mid-line. The client has to hold the tail rather than
    // parse it and drop a reply.
    const split = `
      function handle(message) {
        if (message.method === "initialize") {
          send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
          return;
        }
        if (message.method === "session/new") {
          const whole = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "sess-2" } });
          process.stdout.write(whole.slice(0, 12));
          setTimeout(() => process.stdout.write(whole.slice(12) + "\\n"), 20);
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(split)] });
    expect(await session.start()).toBe("sess-2");
    await session.close();
  });

  it("answers a permission request rather than leaving the turn hanging", async () => {
    const asks = `
      function handle(message) {
        if (message.method === "initialize") { send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }); return; }
        if (message.method === "session/new") { send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s" } }); return; }
        if (message.method === "session/prompt") {
          globalThis.turnId = message.id;
          send({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: {
            sessionId: "s", toolCall: { title: "Delete everything" },
            options: [{ optionId: "a", name: "Allow", kind: "allow_once" },
                      { optionId: "r", name: "Reject", kind: "reject_once" }] } });
          return;
        }
        if (message.id === 99) {
          send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s",
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: message.result.outcome.optionId } } } });
          send({ jsonrpc: "2.0", id: globalThis.turnId, result: { stopReason: "end_turn" } });
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(asks)] });
    const chunks: string[] = [];
    session.on("text", ({ text }) => chunks.push(text));
    session.on("permission", ({ title, deny }) => {
      expect(title).toBe("Delete everything");
      deny();
    });
    await session.start();
    await session.prompt("go");
    // The agent was told which option, and it was the refusal.
    expect(chunks.join("")).toBe("r");
    await session.close();
  });

  it("reports what the agent said on the way out", async () => {
    // A CLI that refuses to start explains itself on stderr, and that sentence
    // is the whole answer to "why did this fail".
    const dies = `
      function handle(message) {
        if (message.method === "initialize") {
          process.stderr.write("Not signed in. Set GEMINI_API_KEY.\\n");
          process.exit(3);
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(dies)] });
    const exited = new Promise<void>((resolve) => session.on("exit", () => resolve()));
    await expect(session.start()).rejects.toThrow(/Not signed in/);
    await exited;
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("refuses a request it never offered to serve, rather than ignoring it", async () => {
    // An unanswered request is a hung turn, so even "no" has to be sent.
    const readsFiles = `
      function handle(message) {
        if (message.method === "initialize") { send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }); return; }
        if (message.method === "session/new") {
          send({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/etc/passwd" } });
          globalThis.newId = message.id;
          return;
        }
        if (message.id === 7) {
          send({ jsonrpc: "2.0", id: globalThis.newId, result: { sessionId: message.error ? "refused" : "served" } });
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(readsFiles)] });
    expect(await session.start()).toBe("refused");
    await session.close();
  });
});

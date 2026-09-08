import { describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";

import { BROWSER_TOOLS, callBrowserTool, handleMcpRequest, startBrowserMcpServer } from "./browser-mcp";
import type { BrowserTarget } from "./browser-tools";

const noPage: BrowserTarget = { contents: () => undefined };

const page: BrowserTarget = {
  contents: () =>
    ({
      getURL: () => "https://example.com/",
      getTitle: () => "Example",
      isLoading: () => false,
      loadURL: async () => undefined,
      executeJavaScriptInIsolatedWorld: async () => ({
        url: "https://example.com/",
        title: "Example",
        text: "Hello",
        elements: [],
      }),
    }) as never,
};

describe("what the agent is offered", () => {
  it("describes each tool with a schema it can call", () => {
    for (const tool of BROWSER_TOOLS) {
      expect(tool.name).toMatch(/^browser_/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("tells the agent to prefer named elements over coordinates", () => {
    const snapshot = BROWSER_TOOLS.find((tool) => tool.name === "browser_snapshot");
    expect(snapshot?.description).toMatch(/coordinates/i);
  });
});

describe("the MCP handshake", () => {
  it("answers initialize with a protocol version and its tools capability", async () => {
    const reply = await handleMcpRequest(page, { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect((reply?.result as { protocolVersion: string }).protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((reply?.result as { capabilities: { tools: unknown } }).capabilities.tools).toBeDefined();
  });

  it("says nothing back to a notification", async () => {
    // A notification has no id, and replying to one is a protocol error.
    expect(await handleMcpRequest(page, { jsonrpc: "2.0", method: "notifications/initialized" }))
      .toBeUndefined();
  });

  it("lists the tools", async () => {
    const reply = await handleMcpRequest(page, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((reply?.result as { tools: unknown[] }).tools).toHaveLength(BROWSER_TOOLS.length);
  });

  it("refuses an unknown method rather than answering it", async () => {
    const reply = await handleMcpRequest(page, { jsonrpc: "2.0", id: 3, method: "resources/list" });
    expect((reply?.error as { code: number }).code).toBe(-32601);
  });
});

describe("calling a tool", () => {
  it("rejects malformed requests and never executes a tool notification", async () => {
    const loadURL = vi.fn();
    const target = { contents: () => ({ loadURL }) as never };
    for (const input of [null, [], 42, { method: "tools/call" }]) {
      expect((await handleMcpRequest(target, input))?.error).toBeDefined();
    }
    expect(await handleMcpRequest(target, { jsonrpc: "2.0", method: "tools/call", params: { name: "browser_navigate", arguments: { url: "https://example.com" } } })).toBeUndefined();
    expect(loadURL).not.toHaveBeenCalled();
    expect((await callBrowserTool(page, "browser_click", { ref: 1 })).ok).toBe(false);
    expect((await callBrowserTool(page, "browser_scroll", { deltaY: Infinity })).ok).toBe(false);
    expect((await callBrowserTool(page, "browser_type", { snapshotId: "id", ref: 1, text: "x".repeat(10001) })).ok).toBe(false);
  });
  it("refuses overlapping actions without building an unbounded queue", async () => {
    let finish!: () => void;
    const target: BrowserTarget = { contents: () => ({ loadURL: () => new Promise<void>((resolve) => { finish = resolve; }), getURL: () => "https://example.com" }) as never };
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_navigate", arguments: { url: "https://example.com" } } };
    const first = handleMcpRequest(target, request);
    const second = await handleMcpRequest(target, request);
    expect(JSON.stringify(second)).toContain("already in progress");
    finish(); await first;
    expect(JSON.stringify(await handleMcpRequest(target, { ...request, params: { name: "browser_status" } }))).not.toContain("already in progress");
  });
  it("returns the answer as text the agent can read", async () => {
    const reply = await handleMcpRequest(page, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "browser_status", arguments: {} },
    });
    const result = reply?.result as { content: Array<{ text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("https://example.com/");
  });

  it("marks a refusal as an error but still explains it", async () => {
    const reply = await handleMcpRequest(page, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "browser_navigate", arguments: { url: "file:///etc/passwd" } },
    });
    const result = reply?.result as { content: Array<{ text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/http and https only/i);
  });

  it("says which tool does not exist", async () => {
    const result = await callBrowserTool(page, "browser_teleport", {});
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("browser_teleport");
  });

  it("reports a closed panel as a state with a way forward", async () => {
    const result = await callBrowserTool(noPage, "browser_snapshot", {});
    expect(result.detail).toMatch(/browser_navigate/);
  });
});

it("authenticates each agent separately and rejects page origins and expired credentials", async () => {
  const server = await startBrowserMcpServer();
  try {
    const first = server.register(page);
    const second = server.register(noPage);
    expect(first.headers).not.toEqual(second.headers);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_status" } });
    const headers = { ...first.headers, "content-type": "application/json" };
    expect((await fetch(first.url, { method: "POST", headers, body })).status).toBe(200);
    expect((await fetch(first.url, { method: "POST", headers: { ...headers, origin: "null" }, body })).status).toBe(403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(first.url, { method: "POST", headers: { ...headers, host: "example.com" } }, (response) => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end(body);
    });
    expect(wrongHost).toBe(403);
    expect((await fetch(first.url + "/elsewhere", { method: "POST", headers, body })).status).toBe(404);
    first.dispose();
    expect((await fetch(first.url, { method: "POST", headers, body })).status).toBe(401);
    const remaining = await fetch(second.url, { method: "POST", headers: { ...second.headers, "content-type": "application/json" }, body });
    expect(await remaining.text()).toContain("No browser page");
    second.dispose();
  } finally { await server.close(); }
});

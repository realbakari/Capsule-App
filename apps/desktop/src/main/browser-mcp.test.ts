import { describe, expect, it } from "vitest";

import { BROWSER_TOOLS, callBrowserTool, handleMcpRequest } from "./browser-mcp";
import type { BrowserTarget } from "./browser-tools";

const noPage: BrowserTarget = { contents: () => undefined };

const page: BrowserTarget = {
  contents: () =>
    ({
      getURL: () => "https://example.com/",
      getTitle: () => "Example",
      isLoading: () => false,
      loadURL: async () => undefined,
      executeJavaScript: async () => ({
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

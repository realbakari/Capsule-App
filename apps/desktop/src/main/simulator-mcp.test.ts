import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) } }));

import { handleLocalMcpRequest, toolSchema, type LocalMcpOptions } from "./local-mcp";
import { SIMULATOR_TOOLS, callSimulatorTool, type SimulatorTarget } from "./simulator-mcp";

const options: LocalMcpOptions<{ id: string }> = {
  name: "test", version: "1",
  tools: [{ name: "echo", description: "Echo.", inputSchema: toolSchema({ text: { type: "string" } }, ["text"]) }],
  call: async (_target, name, args) => ({ ok: true, detail: `${name}:${String(args.text)}` }),
};
const target = { id: "t" };
const request = (method: string, params?: unknown, id: string | number | undefined = 1) => handleLocalMcpRequest(options, target, new Set(), { jsonrpc: "2.0", id, method, params });

describe("local MCP transport", () => {
  it("answers initialize and lists its tools", async () => {
    expect((await request("initialize"))?.result).toMatchObject({ serverInfo: { name: "test" } });
    expect((await request("tools/list"))?.result).toEqual({ tools: options.tools });
  });

  it("never executes a notification, even one naming a tool", async () => {
    expect(await handleLocalMcpRequest(options, target, new Set(), { jsonrpc: "2.0", method: "tools/call", params: { name: "echo", arguments: { text: "x" } } })).toBeUndefined();
  });

  it("rejects unknown tools and unexpected arguments before calling anything", async () => {
    const unknown = (await request("tools/call", { name: "nope", arguments: {} }))?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(unknown.isError).toBe(true);
    const extra = (await request("tools/call", { name: "echo", arguments: { text: "x", other: 1 } }))?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(extra.isError).toBe(true);
    expect(extra.content[0]?.text).toMatch(/Unexpected tool arguments/);
  });

  it("runs a valid call and reports the tool's detail", async () => {
    const result = (await request("tools/call", { name: "echo", arguments: { text: "hi" } }))?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toBe("echo:hi");
  });

  it("refuses overlapping operations on one target instead of queueing", async () => {
    const busy = new Set([target]);
    const result = (await handleLocalMcpRequest(options, target, busy, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "x" } } }))?.result as { isError: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("simulator tools", () => {
  const thread: SimulatorTarget = { threadId: "thread-none", allowed: () => true };

  it("offers no tool that lists, boots, shuts down, installs or configures a device", () => {
    const names = SIMULATOR_TOOLS.map((tool) => tool.name);
    for (const forbidden of ["list", "boot", "shutdown", "install", "privacy", "location", "appearance", "attach"]) {
      expect(names.some((name) => name.includes(forbidden)), forbidden).toBe(false);
    }
    expect(names).toContain("simulator_screenshot");
    expect(names).toContain("simulator_tap");
  });

  it("refuses when the setting is off, before touching any device", async () => {
    const result = await callSimulatorTool({ threadId: "thread-none", allowed: () => false }, "simulator_status", {});
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining("turned off") });
  });

  it("refuses a thread with no attached simulator and says what the user must do", async () => {
    const result = await callSimulatorTool(thread, "simulator_status", {});
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining("Attach") });
  });

  it("says in every mutating tool that dispatch is not proof", () => {
    for (const tool of SIMULATOR_TOOLS) {
      if (["simulator_tap", "simulator_launch"].includes(tool.name)) expect(tool.description).toMatch(/not proof|screenshot/i);
    }
  });
});

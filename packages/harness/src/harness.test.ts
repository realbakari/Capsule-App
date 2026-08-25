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
  PRESET_HARNESSES,
} from "./index.js";

describe("harness catalog", () => {
  it("ships Claude Code and Codex as first-class ACP targets", () => {
    expect(PRESET_HARNESSES.map((item) => item.id)).toEqual(["claude", "codex"]);
  });

  it("builds the OpenClaw ACP spawn command Buzz-style", () => {
    expect(acpSpawnCommand("claude", { cwd: "/repo" })).toBe(
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
    expect(acpOptionCommand("model", "anthropic/claude-opus-4-6")).toBe(
      "/acp model anthropic/claude-opus-4-6",
    );
    expect(acpOptionCommand("cwd", "/Users/me/Work Space")).toBe(
      '/acp cwd "/Users/me/Work Space"',
    );
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
    const parsed = parseAcpStatus("backend: acpx\nmode: persistent\nstate: running\nmodel: claude-opus");
    expect(parsed.backend).toBe("acpx");
    expect(parsed.mode).toBe("persistent");
    expect(parsed.state).toBe("running");
    expect(parsed.model).toBe("claude-opus");
  });
});

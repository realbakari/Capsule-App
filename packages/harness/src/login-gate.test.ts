import { describe, expect, it } from "vitest";
import { harnessDisplayName, isFeaturedHarness, PRESET_HARNESSES } from "@capsule/shared";
import { classifyLoginProbe, describeReadiness, localDoctorChecks } from "./index.js";

const claude = PRESET_HARNESSES.find((p) => p.id === "claude")!;
const codex = PRESET_HARNESSES.find((p) => p.id === "codex")!;
const gemini = PRESET_HARNESSES.find((p) => p.id === "gemini");

const base = {
  preset: claude,
  binaryPath: "/opt/homebrew/bin/claude",
  gatewayConnected: true,
  acpxEnabled: true,
  dedicated: false,
  live: false,
} as const;

describe("classifyLoginProbe", () => {
  /*
   * Real output from the CLIs on a developer machine. Neither harness signals
   * sign-in through its exit code, so these are the cases that matter.
   */
  it("reads claude's JSON body, which exits 0 even when logged out", () => {
    expect(
      classifyLoginProbe({
        ok: true,
        stdout: '{\n  "loggedIn": false,\n  "authMethod": "none",\n  "apiProvider": "firstParty"\n}',
      }),
    ).toBe("logged_out");
  });

  it("reads claude's JSON body when logged in", () => {
    expect(
      classifyLoginProbe({ ok: true, stdout: '{"loggedIn": true, "authMethod": "oauth"}' }),
    ).toBe("logged_in");
  });

  it("reads codex's prose, which also exits 0", () => {
    expect(classifyLoginProbe({ ok: true, stdout: "Logged in using ChatGPT" })).toBe("logged_in");
    expect(classifyLoginProbe({ ok: true, stdout: "Not logged in" })).toBe("logged_out");
  });

  it("falls back to the exit code when output says nothing recognisable", () => {
    expect(classifyLoginProbe({ ok: true, stdout: "" })).toBe("logged_in");
    expect(classifyLoginProbe({ ok: false, stdout: "" })).toBe("logged_out");
  });

  it("ignores malformed JSON rather than throwing", () => {
    expect(classifyLoginProbe({ ok: true, stdout: "{not json" })).toBe("logged_in");
  });

  it("separates a broken config from being logged out", () => {
    expect(
      classifyLoginProbe({ ok: false, stderr: "failed to parse config file at ~/.codex" }),
    ).toBe("config_invalid");
  });

  it("reports unknown when the probe could not run at all", () => {
    // Claiming "logged out" here would block a harness that is actually fine.
    expect(classifyLoginProbe({ ok: false, spawnFailed: true })).toBe("unknown");
  });
});

describe("readiness gating on sign-in", () => {
  it("blocks a signed-out CLI with the hint for that harness", () => {
    const result = describeReadiness({ ...base, loginState: "logged_out" });
    expect(result.readiness).toBe("needs_login");
    expect(result.detail).toContain("not signed in");
    expect(result.detail).toContain("Run `claude`");
  });

  it("uses the codex hint for codex", () => {
    const result = describeReadiness({ ...base, preset: codex, loginState: "logged_out" });
    expect(result.detail).toContain("Run `codex login`");
  });

  it("reports a broken config distinctly", () => {
    expect(describeReadiness({ ...base, loginState: "config_invalid" }).readiness).toBe(
      "needs_login",
    );
  });

  it("stays ready when signed in", () => {
    expect(describeReadiness({ ...base, loginState: "logged_in" }).readiness).toBe("ready");
  });

  it("does not block when the probe result is unknown or absent", () => {
    expect(describeReadiness({ ...base, loginState: "unknown" }).readiness).toBe("ready");
    expect(describeReadiness({ ...base }).readiness).toBe("ready");
  });

  it("keeps a live session running regardless of probe state", () => {
    expect(describeReadiness({ ...base, live: true, loginState: "logged_out" }).readiness).toBe(
      "running",
    );
  });

  it("still reports the gateway first when it is offline", () => {
    const result = describeReadiness({
      ...base,
      gatewayConnected: false,
      loginState: "logged_out",
    });
    expect(result.readiness).toBe("gateway_offline");
  });
});

describe("doctor checks", () => {
  it("adds a sign-in check for harnesses that can be probed", () => {
    const checks = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      loginState: "logged_out",
    });
    const login = checks.find((c) => c.id === "login");
    expect(login?.ok).toBe(false);
    expect(login?.detail).toContain("Run `claude`");
  });

  it("passes the sign-in check when signed in", () => {
    const checks = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      loginState: "logged_in",
    });
    expect(checks.find((c) => c.id === "login")?.ok).toBe(true);
  });

  it("omits the check for harnesses with no login probe", () => {
    if (!gemini) return;
    const checks = localDoctorChecks({
      preset: gemini,
      binaryPath: "/opt/homebrew/bin/gemini",
      gatewayConnected: true,
      acpxEnabled: true,
    });
    expect(checks.find((c) => c.id === "login")).toBeUndefined();
  });
});

describe("harness capability facts", () => {
  it("carries the underlying CLI, config path and provider lock", () => {
    expect(claude.underlyingCli).toBe("claude");
    expect(claude.configFilePath).toBe("~/.claude/settings.json");
    // Claude Code is Anthropic-only, so no provider choice should be offered.
    expect(claude.providerLocked).toBe(true);
    expect(codex.underlyingCli).toBe("codex");
    expect(codex.configFilePath).toBe("~/.codex/config.toml");
    expect(codex.providerLocked ?? false).toBe(false);
  });

  it("marks exactly the featured harnesses", () => {
    const featured = PRESET_HARNESSES.filter(isFeaturedHarness).map((p) => p.id);
    expect(featured).toEqual(["claude", "codex"]);
  });

  it("names every harness without branching on its id", () => {
    // The regression: components used `id === "codex" ? "Codex" : "Claude Code"`,
    // which labelled all 13 other ACP targets as Claude Code.
    expect(harnessDisplayName("claude")).toBe("Claude Code");
    expect(harnessDisplayName("codex")).toBe("Codex");
    for (const preset of PRESET_HARNESSES) {
      expect(harnessDisplayName(preset.id)).toBe(preset.name);
    }
    expect(harnessDisplayName(undefined)).toBe("Agent");
    expect(harnessDisplayName("not-a-harness", "Unknown")).toBe("Unknown");
  });

  it("warns when Gateway acpx is still on the fatal default", () => {
    const checks = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      loginState: "logged_in",
      acpxPolicyKnown: true,
      acpxPermissionMode: "approve-reads",
    });
    const row = checks.find((c) => c.id === "acpx-permissions");
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("approve-all");
  });

  it("treats approve-all and Supervised deny-all as non-fatal", () => {
    const approve = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      acpxPolicyKnown: true,
      acpxPermissionMode: "approve-all",
    });
    expect(approve.find((c) => c.id === "acpx-permissions")?.ok).toBe(true);
    const supervised = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      acpxPolicyKnown: true,
      acpxPermissionMode: "deny-all",
    });
    expect(supervised.find((c) => c.id === "acpx-permissions")?.ok).toBe(true);
    expect(supervised.find((c) => c.id === "acpx-permissions")?.detail).toMatch(/Supervised/i);
  });

  it("surfaces the config path in Doctor", () => {
    const checks = localDoctorChecks({
      preset: claude,
      binaryPath: "/opt/homebrew/bin/claude",
      gatewayConnected: true,
      acpxEnabled: true,
      loginState: "logged_in",
    });
    const config = checks.find((c) => c.id === "config");
    expect(config?.detail).toContain("~/.claude/settings.json");
    expect(config?.detail).toContain("provider is fixed");
  });
});

import { describe, expect, it } from "vitest";
import {
  acpxAgentPatch,
  acpxFromConfig,
  acpxFromHealth,
  acpxFromPluginsList,
  configWriteAttempts,
  acpxHeadlessWritesPatch,
  acpxModeIsNonFatal,
  acpxPermissionPatch,
  acpxPolicyAllowsHeadlessWrites,
  isAcpPermissionRequestEvent,
  readAcpAllowedAgents,
  readAcpPermissionRequest,
  readAcpxAgentCommand,
  readAcpxHarnessPolicy,
  resolveAcpxEnabled,
} from "./plugins.js";

describe("acpx detection", () => {
  it("reads acpx from health.plugins.loaded", () => {
    expect(
      acpxFromHealth({
        ok: true,
        plugins: { loaded: ["bonjour", "acpx", "browser"], errors: [] },
      }),
    ).toBe(true);
    expect(acpxFromHealth({ plugins: { loaded: ["bonjour"], errors: [] } })).toBe(false);
    expect(acpxFromHealth({ runtimeVersion: "2026.7.1-2" })).toBeUndefined();
  });

  it("reads acpx from config.get plugin entries", () => {
    expect(
      acpxFromConfig({
        parsed: { plugins: { entries: { acpx: { enabled: true, config: { timeoutSeconds: 120 } } } } },
      }),
    ).toBe(true);
    expect(
      acpxFromConfig({
        config: { plugins: { entries: { "@openclaw/acpx": { enabled: false } } } },
      }),
    ).toBe(false);
    expect(acpxFromConfig({ parsed: { gateway: { mode: "local" } } })).toBeUndefined();
  });

  it("reads acpx from plugins.list rows when that method exists", () => {
    expect(
      acpxFromPluginsList({
        plugins: [{ id: "acpx", name: "ACPX Runtime", enabled: true, state: "enabled" }],
        diagnostics: [],
        mutationAllowed: true,
      }),
    ).toBe(true);
    expect(acpxFromPluginsList({ plugins: [{ id: "browser", enabled: true }] })).toBe(false);
    expect(acpxFromPluginsList({ ok: true })).toBeUndefined();
  });

  it("prefers a loaded health inventory over a missing plugins.list method", () => {
    expect(
      resolveAcpxEnabled({
        health: { plugins: { loaded: ["acpx"], errors: [] } },
        pluginsList: undefined,
      }),
    ).toBe(true);
    expect(resolveAcpxEnabled({ health: { plugins: { loaded: [], errors: [] } } })).toBe(false);
  });
});

describe("acpx harness policy", () => {
  it("reads permissionMode from config.get entries", () => {
    expect(
      readAcpxHarnessPolicy({
        parsed: {
          plugins: {
            entries: {
              acpx: { enabled: true, config: { permissionMode: "approve-reads" } },
            },
          },
        },
      }),
    ).toEqual({
      pluginId: "acpx",
      permissionMode: "approve-reads",
      nonInteractivePermissions: undefined,
    });
  });

  it("reads a custom native ACP command and an explicit agent allowlist", () => {
    const config = {
      parsed: {
        acp: { allowedAgents: ["claude"] },
        plugins: {
          entries: {
            acpx: {
              enabled: true,
              config: { agents: { grok: { command: "grok", args: ["agent", "stdio"] } } },
            },
          },
        },
      },
    };
    expect(readAcpxAgentCommand(config, "grok")).toEqual({
      pluginId: "acpx",
      command: "grok",
      args: ["agent", "stdio"],
    });
    expect(readAcpAllowedAgents(config)).toEqual(["claude"]);
    expect(readAcpAllowedAgents({ parsed: { acp: {} } })).toBeUndefined();
  });

  it("patches a custom ACP command without inventing an allowlist", () => {
    expect(acpxAgentPatch("acpx", "grok", { command: "grok", args: ["agent", "stdio"] })).toEqual({
      plugins: {
        entries: {
          acpx: {
            enabled: true,
            config: { agents: { grok: { command: "grok", args: ["agent", "stdio"] } } },
          },
        },
      },
    });
    expect(
      acpxAgentPatch(
        "acpx",
        "grok",
        { command: "grok", args: ["agent", "stdio"] },
        ["claude"],
      ),
    ).toMatchObject({ acp: { allowedAgents: ["claude", "grok"] } });
  });

  it("treats only approve-all as headless-write capable", () => {
    expect(acpxPolicyAllowsHeadlessWrites({ permissionMode: "approve-all" })).toBe(true);
    expect(acpxPolicyAllowsHeadlessWrites({ permissionMode: "approve-reads" })).toBe(false);
    expect(acpxPolicyAllowsHeadlessWrites({})).toBe(false);
  });

  it("patches the plugin config Capsule needs for Standard/Full access", () => {
    expect(acpxHeadlessWritesPatch("acpx")).toEqual({
      plugins: {
        entries: {
          acpx: {
            enabled: true,
            config: { permissionMode: "approve-all", nonInteractivePermissions: "deny" },
          },
        },
      },
    });
  });

  it("patches deny-all for Supervised", () => {
    expect(acpxPermissionPatch("acpx", "deny-all").plugins).toEqual({
      entries: {
        acpx: {
          enabled: true,
          config: { permissionMode: "deny-all", nonInteractivePermissions: "deny" },
        },
      },
    });
  });

  it("treats only approve-all and deny-all as non-fatal", () => {
    expect(acpxModeIsNonFatal("approve-all")).toBe(true);
    expect(acpxModeIsNonFatal("deny-all")).toBe(true);
    expect(acpxModeIsNonFatal("approve-reads")).toBe(false);
    expect(acpxModeIsNonFatal(undefined)).toBe(false);
  });

  it("recognizes ACP permission RPCs without swallowing exec approvals", () => {
    expect(isAcpPermissionRequestEvent("exec.approval.requested", {})).toBe(false);
    expect(isAcpPermissionRequestEvent("plugin.approval.requested", {})).toBe(false);
    expect(isAcpPermissionRequestEvent("acp.permission.requested", {})).toBe(true);
    expect(
      isAcpPermissionRequestEvent("agent", { method: "session/request_permission" }),
    ).toBe(true);
    expect(
      isAcpPermissionRequestEvent("agent", {
        params: { toolCall: { kind: "edit", title: "Write file" }, options: [{ optionId: "allow-once" }] },
      }),
    ).toBe(true);
  });

  it("reads ACP permission fields for Capsule Approvals", () => {
    expect(
      readAcpPermissionRequest({
        method: "session/request_permission",
        requestId: "req-1",
        sessionKey: "agent:claude:acp:abc",
        params: { toolCall: { kind: "execute", title: "npm test" } },
      }),
    ).toEqual({
      id: "req-1",
      tool: "execute",
      title: "npm test",
      sessionKey: "agent:claude:acp:abc",
      runId: undefined,
      agentId: undefined,
      action: "execute",
    });
  });
});

describe("configWriteAttempts", () => {
  it("asks the way this Gateway accepts before the ways older ones did", () => {
    const patch = { plugins: { entries: { acpx: { enabled: true } } } };
    const attempts = configWriteAttempts(patch, "plugins.entries.acpx.enabled", true);
    expect(attempts[0]).toEqual({
      method: "config.patch",
      params: { raw: JSON.stringify(patch) },
    });
    expect(attempts.map((attempt) => attempt.method)).toEqual([
      "config.patch",
      "config.patch",
      "config.patch",
      "config.set",
      "config.set",
    ]);
  });
});

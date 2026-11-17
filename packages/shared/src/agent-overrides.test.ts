import { describe, expect, it } from "vitest";
import { agentEnabled, formatEnvLines, normalizeAgentOverrides, parseEnvLines, patchAgentOverrides } from "./agent-overrides.js";
import { normalizeCapsuleSettings } from "./runtime.js";

describe("agent overrides in settings", () => {
  it("keeps what a person set and drops what Capsule cannot use", () => {
    expect(normalizeCapsuleSettings({ agentOverrides: {
      claude: { enabled: false, binaryPath: "  ~/bin/claude  ", args: ["--verbose", "", 3], env: { CLAUDE_CONFIG_DIR: "~/.claude-work", "BAD NAME": "x", NUM: 1 } },
      codex: { enabled: true },
      "not-an-agent": { enabled: false },
    } as never }).agentOverrides).toEqual({
      claude: { enabled: false, binaryPath: "~/bin/claude", args: ["--verbose"], env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } },
    });
    expect(normalizeCapsuleSettings({}).agentOverrides).toBeUndefined();
    expect(normalizeAgentOverrides("corrupt")).toBeUndefined();
  });

  it("treats an agent as on unless it was turned off", () => {
    expect(agentEnabled(undefined, "claude")).toBe(true);
    expect(agentEnabled({ claude: { enabled: false } }, "claude")).toBe(false);
    expect(agentEnabled({ claude: { enabled: false } }, "codex")).toBe(true);
    expect(agentEnabled({ claude: { enabled: false } }, "general")).toBe(true);
  });

  it("patches one agent and removes it once nothing is left to override", () => {
    const off = patchAgentOverrides(undefined, "claude", { enabled: false });
    expect(off).toEqual({ claude: { enabled: false } });
    const pathSet = patchAgentOverrides(off, "claude", { binaryPath: "/opt/claude" });
    expect(pathSet).toEqual({ claude: { enabled: false, binaryPath: "/opt/claude" } });
    expect(patchAgentOverrides(patchAgentOverrides(pathSet, "claude", { enabled: true }), "claude", { binaryPath: undefined })).toEqual({});
  });
});

describe("environment lines", () => {
  it("reads NAME=value lines and names the ones that are not", () => {
    expect(parseEnvLines("A=1\n\n# note\nB = two words\nnot an assignment\n=x")).toEqual({
      env: { A: "1", B: "two words" },
      invalid: ["not an assignment", "=x"],
    });
  });

  it("round-trips through the text a person edits", () => {
    const env = { CLAUDE_CONFIG_DIR: "~/.claude-work", EMPTY: "" };
    expect(parseEnvLines(formatEnvLines(env)).env).toEqual(env);
  });
});

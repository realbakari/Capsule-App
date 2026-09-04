import { describe, expect, it } from "vitest";
import { acpLabelToken, acpOptionCommand, acpSpawnCommand, acpxPermissionMode, HARNESS_PERMISSION_PROFILES } from "./harness.js";

/*
 * acpx parses slash-command arguments with `.trim().split(/\s+/)` and no quote
 * handling, so every option value it receives has to survive that split intact.
 */
function acpxTokens(command: string): string[] {
  return command.slice("/acp".length).trim().split(/\s+/).filter(Boolean);
}

describe("acpLabelToken", () => {
  it("collapses whitespace and punctuation into one token", () => {
    expect(acpLabelToken("Claude Code · Inbox")).toBe("Claude-Code-Inbox");
  });

  it("leaves an already-safe token alone", () => {
    expect(acpLabelToken("claude-code")).toBe("claude-code");
  });

  it("never returns an empty token", () => {
    expect(acpLabelToken("···")).toBe("capsule");
    expect(acpLabelToken("")).toBe("capsule");
  });

  it("bounds the length", () => {
    expect(acpLabelToken("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("acpSpawnCommand", () => {
  it("emits a label acpx parses as a single value", () => {
    const command = acpSpawnCommand("claude", { label: "Claude Code · Inbox" });
    const tokens = acpxTokens(command);
    const labelIndex = tokens.indexOf("--label");
    expect(labelIndex).toBeGreaterThan(-1);
    expect(tokens[labelIndex + 1]).toBe("Claude-Code-Inbox");
    // The regression: a multi-word label used to leave a stray positional
    // behind, which acpx rejected with "Unexpected argument: Code".
    expect(tokens.slice(labelIndex + 2)).toEqual([]);
  });

  it("passes a space-free cwd through unquoted", () => {
    const command = acpSpawnCommand("claude", { cwd: "/Users/me/code/site" });
    const tokens = acpxTokens(command);
    expect(tokens[tokens.indexOf("--cwd") + 1]).toBe("/Users/me/code/site");
  });

  it("requires the adapter to resolve a folder alias for whitespace paths", () => {
    expect(() => acpSpawnCommand("claude", { cwd: "/Users/me/Open Source/Capsule" })).toThrow(
      /resolve a folder alias/i,
    );
    expect(() => acpOptionCommand("cwd", "/Users/me/Open Source/Capsule")).toThrow(/resolve a folder alias/i);
  });

  it("passes punctuation in cwd literally, without shell quoting", () => {
    const cwd = '/repo/café-"quoted"-$folder';
    expect(acpOptionCommand("cwd", cwd, "agent:claude:acp:123")).toBe(`/acp cwd ${cwd} agent:claude:acp:123`);
    expect(acpSpawnCommand("claude", { cwd })).toContain(`--cwd ${cwd}`);
  });

  it("produces no token containing a quote character", () => {
    const command = acpSpawnCommand("claude", {
      cwd: "/Users/me/code/site",
      label: "Claude Code · Inbox",
    });
    expect(command).not.toMatch(/["']/);
  });
});

describe("acpx permission modes", () => {
  /*
   * acpx only accepts approve-all | approve-reads | deny-all, and only the two
   * ends are non-fatal — approve-reads still throws
   * PermissionPromptUnavailableError on the first write or command.
   */
  const ACPX_MODES = ["approve-all", "approve-reads", "deny-all"];
  const NON_FATAL = ["approve-all", "deny-all"];

  it("emits a mode acpx actually understands for every profile", () => {
    for (const profile of HARNESS_PERMISSION_PROFILES) {
      expect(ACPX_MODES).toContain(acpxPermissionMode(profile));
    }
  });

  it("never emits a mode that dies on the first tool call", () => {
    for (const profile of HARNESS_PERMISSION_PROFILES) {
      expect(NON_FATAL).toContain(acpxPermissionMode(profile));
    }
  });

  it("maps supervised to a refusal rather than a prompt", () => {
    // "Ask me" is impossible over ACP; denying is the honest degradation.
    expect(acpxPermissionMode("strict")).toBe("deny-all");
  });

  it("lets standard and full access do work", () => {
    expect(acpxPermissionMode("default")).toBe("approve-all");
    expect(acpxPermissionMode("approve-all")).toBe("approve-all");
  });

  it("falls back to a working mode when no profile is set", () => {
    // The regression: an unset profile left acpx on its fatal default.
    expect(acpxPermissionMode(undefined)).toBe("approve-all");
  });

  it("keeps already-mapped acpx values", () => {
    expect(acpxPermissionMode("deny-all")).toBe("deny-all");
    expect(acpxPermissionMode("approve-all")).toBe("approve-all");
  });

  it("never sends the literal Capsule profile name", () => {
    // "strict" was sent verbatim and silently ignored by acpx.
    for (const profile of HARNESS_PERMISSION_PROFILES) {
      if (profile === "approve-all") continue;
      expect(acpxPermissionMode(profile)).not.toBe(profile);
    }
  });
});

describe("acp permissions command", () => {
  it("never sends Capsule profile names on the wire", async () => {
    const { acpOptionCommand } = await import("./harness.js");
    expect(acpOptionCommand("permissions", "default")).toBe("/acp permissions approve-all");
    expect(acpOptionCommand("permissions", "approve-all")).toBe("/acp permissions approve-all");
    expect(acpOptionCommand("permissions", "strict")).toBe("/acp permissions deny-all");
  });
});

describe("acp option commands name their target session", () => {
  /*
   * Gateway usage: /acp permissions <profile> [session-key|session-id|label].
   * Without the target the command only affects the session it was sent to —
   * and an ACP-bound session hands it to the agent as text instead, so it does
   * nothing at all.
   */
  const ACP_KEY = "agent:claude:acp:e73d79a3-5265-436d-9184-e28c72e36d53";

  it("appends the target to every option command", () => {
    expect(acpOptionCommand("permissions", "default", ACP_KEY)).toBe(
      `/acp permissions approve-all ${ACP_KEY}`,
    );
    expect(acpOptionCommand("model", "opus", ACP_KEY)).toBe(`/acp model opus ${ACP_KEY}`);
    expect(acpOptionCommand("timeout", "30", ACP_KEY)).toBe(`/acp timeout 30 ${ACP_KEY}`);
  });

  it("omits the target when none is given", () => {
    expect(acpOptionCommand("permissions", "default")).toBe("/acp permissions approve-all");
  });

  it("keeps every token whitespace-free so acpx can parse it", () => {
    const tokens = acpOptionCommand("permissions", "strict", ACP_KEY)
      .slice("/acp".length)
      .trim()
      .split(/\s+/);
    expect(tokens).toEqual(["permissions", "deny-all", ACP_KEY]);
  });

  it("translates the profile rather than passing Capsule's name through", () => {
    // "strict" is not a mode acpx understands.
    expect(acpOptionCommand("permissions", "strict", ACP_KEY)).toContain("deny-all");
    expect(acpOptionCommand("permissions", "strict", ACP_KEY)).not.toContain("strict");
  });
});

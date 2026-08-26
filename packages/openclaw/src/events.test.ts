import { describe, expect, it } from "vitest";
import { acpCommandFailed, compactParams, explainAcpFailure, extractAcpSessionKey, extractGatewayText, isGatewayTurnDone } from "./events.js";

describe("gateway chat extraction", () => {
  it("reads ChatEvent deltaText and final message content", () => {
    expect(extractGatewayText({ deltaText: "Hel" })).toBe("Hel");
    expect(extractGatewayText({ message: { content: "ACP ready" } })).toBe("ACP ready");
    expect(
      extractGatewayText({
        message: { content: [{ type: "text", text: "spawned " }, { text: "claude" }] },
      }),
    ).toBe("spawned claude");
  });

  it("treats final and aborted states as done", () => {
    expect(isGatewayTurnDone({ state: "delta" })).toBe(false);
    expect(isGatewayTurnDone({ state: "final" })).toBe(true);
    expect(isGatewayTurnDone({ state: "aborted" })).toBe(true);
  });

  it("flags ACP spawn failures", () => {
    expect(acpCommandFailed("ACP runtime backend is not configured")).toBeTruthy();
    expect(acpCommandFailed("This /acp action requires operator.admin on the internal channel.")).toBeTruthy();
    expect(acpCommandFailed('No API key found for provider "openai"')).toBeTruthy();
    expect(acpCommandFailed("⚠️ Conversation bindings are unavailable for webchat.")).toBeTruthy();
    expect(acpCommandFailed("Spawned ACP session agent:claude:acp:1")).toBeUndefined();
  });

  it("extracts the ACP session key from spawn confirmation", () => {
    expect(
      extractAcpSessionKey(
        "✅ Spawned ACP session agent:claude:acp:9b2c1a77-4e0a-4d3c-9f1e-2 (persistent, backend acpx).",
      ),
    ).toBe("agent:claude:acp:9b2c1a77-4e0a-4d3c-9f1e-2");
  });

  it("drops undefined RPC fields", () => {
    expect(compactParams({ key: "s1", message: undefined, cwd: "/repo" })).toEqual({
      key: "s1",
      cwd: "/repo",
    });
  });
});

describe("explainAcpFailure", () => {
  it("tells you what to do about a non-interactive permission prompt", () => {
    const out = explainAcpFailure(
      "ACP error (ACP_TURN_FAILED): Permission prompt unavailable in non-interactive mode",
    );
    expect(out).toContain("approve-all");
    expect(out).toContain("plugins.entries.acpx.config.permissionMode");
    expect(out).toContain("gateway restart");
    // The original line is kept so the underlying cause is not hidden.
    expect(out).toContain("ACP_TURN_FAILED");
  });

  it("explains an auth failure", () => {
    expect(explainAcpFailure("AcpRuntimeError: Authentication required")).toContain("not signed in");
  });

  it("explains the missing-provider case as a routing problem", () => {
    expect(explainAcpFailure('No API key found for provider "openai"')).toContain("Dedicate a harness");
  });

  it("passes unknown failures through unchanged", () => {
    expect(explainAcpFailure("something we have never seen")).toBe("something we have never seen");
  });

  it("returns undefined for empty input", () => {
    expect(explainAcpFailure("   ")).toBeUndefined();
    expect(explainAcpFailure(undefined)).toBeUndefined();
  });
});

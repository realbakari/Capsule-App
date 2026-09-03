import { describe, expect, it } from "vitest";

import {
  DirectAcpHost,
  directCapableHarnesses,
  directSessionKey,
  isDirectSessionKey,
  supportsDirectMode,
} from "./host.js";

describe("which harnesses direct mode can drive", () => {
  it("is the ones that speak ACP on their own", () => {
    // The preset's own ACP command is the fact; a list written here would
    // drift the moment a harness gains or loses one.
    expect(supportsDirectMode("grok")).toBe(true);
    expect(supportsDirectMode("gemini-flash")).toBe(true);
  });

  it("is not Claude Code or Codex, which reach ACP through an adapter", () => {
    expect(supportsDirectMode("claude")).toBe(false);
    expect(supportsDirectMode("codex")).toBe(false);
  });

  it("names them for a settings screen rather than making one up", () => {
    const capable = directCapableHarnesses();
    expect(capable).toContain("grok");
    expect(capable).not.toContain("claude");
  });
});

describe("session keys", () => {
  it("cannot be mistaken for a Gateway session", () => {
    // A thread keeps the route it started on, and the key is what says which.
    const key = directSessionKey("grok", "abc");
    expect(isDirectSessionKey(key)).toBe(true);
    expect(isDirectSessionKey("agent:main:acp:grok:1")).toBe(false);
    expect(isDirectSessionKey(undefined)).toBe(false);
  });
});

describe("spawning an agent that has no ACP mode", () => {
  it("says so instead of starting something that cannot answer", async () => {
    const host = new DirectAcpHost();
    await expect(host.spawnAcpSession({ harnessId: "claude" })).rejects.toThrow(
      /no ACP mode of its own/,
    );
  });
});

describe("options in direct mode", () => {
  it("says a mid-session change is not carried rather than dropping it", async () => {
    // Accepting the change and doing nothing is the failure mode worth avoiding:
    // the picker would move and the agent would keep the old value.
    const host = new DirectAcpHost();
    await expect(host.setAcpOption("direct:acp:grok:1", "model", "x")).resolves.toMatch(
      /start it again/,
    );
    await expect(host.setAcpOption("direct:acp:grok:1", "permissions", "y")).resolves.toMatch(
      /does not carry/,
    );
  });
});

describe("status for a session that is not running", () => {
  it("reports closed rather than inventing a live one", async () => {
    const host = new DirectAcpHost();
    const status = await host.statusAcp("direct:acp:grok:missing");
    expect(status.parsed.state).toBe("closed");
  });
});

import { describe, expect, it } from "vitest";
import type { AgentStoreEntry } from "@capsule/shared";
import { displayCommand, pendingUpdates, storeRow } from "./agent-store-model";

const offer = (kind: "npm" | "registry"): AgentStoreEntry => ({
  harnessId: "claude",
  offer: {
    version: "2.1.0",
    kind: kind === "npm" ? "npm" : "binary",
    source: kind === "npm" ? { kind: "npm", packageName: "@anthropic-ai/claude-code" } : { kind: "registry", registryId: "claude" },
  },
});

describe("storeRow", () => {
  it("offers an install and says where it comes from", () => {
    expect(storeRow(offer("npm"), undefined)).toEqual({ kind: "offer", version: "2.1.0", from: "from npm" });
    expect(storeRow(offer("registry"), undefined)).toEqual({ kind: "offer", version: "2.1.0", from: "from the ACP registry" });
  });

  it("names a copy the user installed with its version, and offers no install for it", () => {
    expect(storeRow({ ...offer("npm"), user: { path: "/opt/homebrew/bin/claude", version: "2.1.0", latest: "2.1.0" } }, undefined))
      .toEqual({ kind: "user", path: "/opt/homebrew/bin/claude", version: "2.1.0" });
  });

  it("offers the owner's update for a copy the user installed that is behind", () => {
    const user = { path: "/usr/local/bin/claude", version: "2.0.0", latest: "2.1.0", update: { via: "npm" as const, command: "npm install -g @anthropic-ai/claude-code@2.1.0", oneClick: true } };
    expect(storeRow({ ...offer("npm"), user }, undefined)).toEqual({
      kind: "user", path: "/usr/local/bin/claude", version: "2.0.0",
      update: { version: "2.1.0", command: "npm install -g @anthropic-ai/claude-code@2.1.0", oneClick: true },
    });
    expect(storeRow({ ...offer("npm"), user }, { harnessId: "claude", phase: "updating", detail: user.update.command })).toEqual({ kind: "busy", label: "Updating" });
  });

  it("offers the newer version for a copy Capsule installed", () => {
    const entry: AgentStoreEntry = { ...offer("npm"), installed: { version: "2.0.0", kind: "npm", installedAt: "2026-11-01T00:00:00Z" }, updateAvailable: true };
    expect(storeRow(entry, undefined)).toEqual({ kind: "installed", version: "2.0.0", update: "2.1.0" });
    expect(storeRow({ ...entry, updateAvailable: false }, undefined)).toEqual({ kind: "installed", version: "2.0.0", update: undefined });
  });

  it("says why Install is unavailable instead of offering it", () => {
    expect(storeRow({ ...offer("npm"), unavailable: "Needs Node.js" }, undefined)).toEqual({ kind: "unavailable", reason: "Needs Node.js" });
  });

  it("shows progress, with bytes when the download size is known", () => {
    expect(storeRow(offer("npm"), { harnessId: "claude", phase: "downloading", received: 5_000_000, total: 20_000_000 }))
      .toEqual({ kind: "busy", label: "Downloading", bytes: "5.0 of 20 MB", fraction: 0.25 });
    expect(storeRow(offer("npm"), { harnessId: "claude", phase: "resolving" })).toEqual({ kind: "busy", label: "Finding the release", bytes: undefined, fraction: undefined });
    expect(storeRow(undefined, { harnessId: "claude", phase: "removing" })).toEqual({ kind: "busy", label: "Removing" });
  });

  it("reports a failure and offers a retry only when there is something to install", () => {
    expect(storeRow(offer("npm"), { harnessId: "claude", phase: "failed", error: "Checksum mismatch" })).toEqual({ kind: "failed", error: "Checksum mismatch", canRetry: true });
    expect(storeRow(undefined, { harnessId: "claude", phase: "failed", error: "Not implemented" })).toEqual({ kind: "failed", error: "Not implemented", canRetry: false });
  });

  it("shows nothing for an agent the store does not carry", () => {
    expect(storeRow(undefined, undefined)).toEqual({ kind: "none" });
  });
});

describe("displayCommand", () => {
  it("quotes only the parts a shell would split", () => {
    expect(displayCommand(["claude", "auth", "login"])).toBe("claude auth login");
    expect(displayCommand(["agent", "--name", "my agent", "it's"])).toBe("agent --name 'my agent' 'it'\\''s'");
  });
});

describe("pendingUpdates", () => {
  const managed: AgentStoreEntry = { ...offer("registry"), harnessId: "gemini", installed: { version: "2.0.0", kind: "binary", installedAt: "2026-11-01T00:00:00Z" }, updateAvailable: true };
  const behind: AgentStoreEntry = { ...offer("npm"), user: { path: "/usr/local/bin/claude", version: "2.0.0", latest: "2.1.0", update: { via: "homebrew", command: "brew upgrade claude", oneClick: false } } };

  it("lists a copy Capsule installed and a copy the user installed, each with how it updates", () => {
    expect(pendingUpdates([managed, behind])).toEqual([
      { harnessId: "gemini", from: "2.0.0", to: "2.1.0", how: { kind: "store" } },
      { harnessId: "claude", from: "2.0.0", to: "2.1.0", how: { kind: "user", command: "brew upgrade claude", oneClick: false } },
    ]);
  });

  it("skips agents that are current, turned off, or a second preset over the same copy", () => {
    const current: AgentStoreEntry = { ...offer("npm"), harnessId: "codex", user: { path: "/usr/local/bin/codex", version: "1.0.0", latest: "1.0.0" } };
    expect(pendingUpdates([current, { ...managed, updateAvailable: false }])).toEqual([]);
    expect(pendingUpdates([managed, behind], (id) => id !== "claude").map((item) => item.harnessId)).toEqual(["gemini"]);
    expect(pendingUpdates([managed, { ...managed, harnessId: "gemini-flash" }]).map((item) => item.harnessId)).toEqual(["gemini"]);
  });

  it("does not offer Capsule's own copy when the user's copy is the one that runs", () => {
    expect(pendingUpdates([{ ...managed, user: { path: "/usr/local/bin/gemini", version: "3.0.0" } }])).toEqual([]);
  });
});

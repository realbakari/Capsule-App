import { describe, expect, it } from "vitest";
import type { AgentStoreEntry } from "@capsule/shared";
import { displayCommand, storeRow } from "./agent-store-model";

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

  it("names a copy the user installed and offers nothing for it", () => {
    expect(storeRow({ ...offer("npm"), userPath: "/opt/homebrew/bin/claude" }, undefined)).toEqual({ kind: "user", path: "/opt/homebrew/bin/claude" });
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

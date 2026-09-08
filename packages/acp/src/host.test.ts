import { describe, expect, it, vi } from "vitest";
import { DirectAcpSession } from "./session.js";
import { PRESET_HARNESSES, type DirectSessionIdentity } from "@capsule/shared";
import path from "node:path";

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
  it("rejects resume identities for another folder, harness, launch command or invalid native ID before spawning", async () => {
    const host = new DirectAcpHost();
    const cwd = path.resolve(".");
    const identity: DirectSessionIdentity = { sessionId: "saved", cwd, harnessId: "grok", launchSignature: JSON.stringify(PRESET_HARNESSES.find((item) => item.id === "grok")!.acpxCommand) };
    const start = vi.spyOn(DirectAcpSession.prototype, "start");
    const offer = vi.fn(() => ({ servers: [], dispose: () => {} }));
    host.offerMcpServers(offer);
    try {
      for (const patch of [{ cwd: path.join(cwd, "another") }, { harnessId: "gemini-flash" }, { launchSignature: "different" }, { sessionId: "" }]) {
        await expect(host.spawnAcpSession({ harnessId: "grok", cwd, resume: { ...identity, ...patch } })).rejects.toThrow(/saved agent session/i);
      }
      expect(start).not.toHaveBeenCalled(); expect(offer).not.toHaveBeenCalled();
    } finally { start.mockRestore(); }
  });
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

it("closes a failed handshake without retaining the session or sending a turn", async () => {
  const start = vi.spyOn(DirectAcpSession.prototype, "start").mockRejectedValue(new Error("Unsupported ACP protocol version"));
  const close = vi.spyOn(DirectAcpSession.prototype, "close").mockResolvedValue();
  const prompt = vi.spyOn(DirectAcpSession.prototype, "prompt");
  const host = new DirectAcpHost();
  const dispose = vi.fn();
  const offer = vi.fn(() => ({ servers: [], dispose }));
  host.offerMcpServers(offer);
  try {
    await expect(host.spawnAcpSession({ harnessId: "grok", threadId: "thread-a", prompt: "Must not send" })).rejects.toThrow("Unsupported ACP protocol version");
    expect(offer).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-a" }));
    expect(dispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
    await host.closeAll();
    expect(close).toHaveBeenCalledOnce();
  } finally { start.mockRestore(); close.mockRestore(); prompt.mockRestore(); }
});

describe("options in direct mode", () => {
  it("refuses options for a process that is no longer running", async () => {
    // Accepting the change and doing nothing is the failure mode worth avoiding:
    // the picker would move and the agent would keep the old value.
    const host = new DirectAcpHost();
    await expect(host.setAcpOption("direct:acp:grok:1", "model", "x")).rejects.toThrow(
      /start it again/i,
    );
    await expect(host.setAcpOption("direct:acp:grok:1", "permissions", "y")).rejects.toThrow(
      /no longer running/,
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

describe("the models a direct session offers", () => {
  it("hands over what the agent named when the session opened", async () => {
    /*
     * `session/new` answers with them — grok replies with grok-4.6 and
     * grok-4.5 and says which is current — and this used to read the session
     * id out of that reply and drop the rest, leaving the composer's picker
     * with nothing while the answer sat in the response.
     */
    const host = new DirectAcpHost();
    const sessions = (host as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set("direct:acp:grok:1", {
      running: true,
      models: {
        currentModelId: "grok-4.6",
        availableModels: [
          { modelId: "grok-4.6", name: "Grok 4.6" },
          { modelId: "grok-4.5", name: "Grok 4.5" },
        ],
      },
    });

    const status = await host.statusAcp("direct:acp:grok:1");
    expect(status.parsed.models?.availableModels.map((m) => m.modelId)).toEqual([
      "grok-4.6",
      "grok-4.5",
    ]);
    expect(status.parsed.model).toBe("grok-4.6");
  });

  it("says nothing about models when the agent named none", async () => {
    const host = new DirectAcpHost();
    const status = await host.statusAcp("direct:acp:grok:missing");
    expect(status.parsed.models).toBeUndefined();
  });
});

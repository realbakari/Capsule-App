import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OpenClawAdapter } from "./adapter.js";
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, probeTcp } from "./discovery.js";

describe("OpenClawAdapter live connect", () => {
  it("presents a device identity to a running local Gateway", async () => {
    const reachable = await probeTcp(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
    if (!reachable) return;
    const adapter = new OpenClawAdapter({
      identityDir: mkdtempSync(path.join(tmpdir(), "capsule-gw-")),
      clientVersion: "0.1.0-test",
    });
    await adapter.connect();
    const status = await adapter.getStatus();
    expect(status.state).toBe("connected");
    expect(status.error).toBeUndefined();
    expect(await adapter.hasAcpxPlugin()).toBe(true);
    const key = await adapter.ensureOperatorSession({
      requestedAgentId: "general",
      label: `capsule-agent-map-${Date.now()}`,
    });
    expect(key.startsWith("agent:main:") || key === "main").toBe(true);
    await adapter.disconnect();
  });
});

describe("OpenClawAdapter ACP lifecycle", () => {
  function replyToControl(adapter: OpenClawAdapter, text: string) {
    const emitter = (adapter as unknown as { emitter: { emit: (...args: unknown[]) => boolean } }).emitter;
    return vi.spyOn(adapter, "sendSlash").mockImplementation(async (sessionKey) => {
      emitter.emit("acp-reply", { sessionKey, text, done: true });
    });
  }

  it("registers Grok's native ACP command with acpx", async () => {
    const adapter = new OpenClawAdapter();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        parsed: { plugins: { entries: { acpx: { enabled: true, config: {} } } } },
      })
      .mockResolvedValueOnce({});
    (adapter as unknown as { client: { request: typeof request } }).client = { request };

    await expect(
      adapter.ensureAcpxAgentCommand("grok", { command: "grok", args: ["agent", "stdio"] }),
    ).resolves.toEqual({ already: false, applied: true });
    // The Gateway takes the patch as a JSON5 document under `raw`. Passing the
    // object itself came back as "must have required property 'raw'".
    expect(request).toHaveBeenNthCalledWith(2, "config.patch", {
      raw: JSON.stringify({
        plugins: {
          entries: {
            acpx: {
              enabled: true,
              config: { agents: { grok: { command: "grok", args: ["agent", "stdio"] } } },
            },
          },
        },
      }),
    });
  });

  it("quotes the config hash back so the Gateway accepts the write", async () => {
    // The Gateway writes optimistically: no hash, no write.
    const adapter = new OpenClawAdapter();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        hash: "sha256:abc123",
        parsed: { plugins: { entries: { acpx: { enabled: true, config: {} } } } },
      })
      .mockResolvedValueOnce({});
    (adapter as unknown as { client: { request: typeof request } }).client = { request };

    await expect(
      adapter.ensureAcpxAgentCommand("grok", { command: "grok", args: ["agent", "stdio"] }),
    ).resolves.toEqual({ already: false, applied: true });
    const [, params] = request.mock.calls[1] ?? [];
    expect((params as { baseHash?: string }).baseHash).toBe("sha256:abc123");
  });

  it("keeps an existing Grok ACP command without rewriting Gateway config", async () => {
    const adapter = new OpenClawAdapter();
    const request = vi.fn().mockResolvedValue({
      parsed: {
        plugins: {
          entries: {
            acpx: {
              enabled: true,
              config: { agents: { grok: { command: "grok", args: ["agent", "stdio"] } } },
            },
          },
        },
      },
    });
    (adapter as unknown as { client: { request: typeof request } }).client = { request };

    await expect(
      adapter.ensureAcpxAgentCommand("grok", { command: "grok", args: ["agent", "stdio"] }),
    ).resolves.toEqual({ already: true, applied: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("subscribes for a control reply before sending a fast slash command", async () => {
    const adapter = new OpenClawAdapter();
    const send = replyToControl(adapter, "ACP session closed");

    await expect(adapter.closeAcp("agent:main:acp:closed")).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith("agent:main:acp:closed", "/acp close");
  });

  it("spawns an unbound ACP session and returns the acpx session key", async () => {
    const adapter = new OpenClawAdapter();
    const send = replyToControl(
      adapter,
      "✅ Spawned ACP session agent:claude:acp:abc-def (persistent, backend acpx). Session is unbound.",
    );
    (adapter as unknown as { createGatewaySession: () => Promise<string> }).createGatewaySession = async () =>
      "agent:main:dashboard:parent";
    (adapter as unknown as { subscribeSession: () => Promise<void> }).subscribeSession = async () => undefined;

    const spawned = await adapter.spawnAcpSession({ harnessId: "claude", title: "Work" });
    expect(spawned.sessionKey).toBe("agent:claude:acp:abc-def");
    expect(send).toHaveBeenCalledWith(
      "agent:main:dashboard:parent",
      "/acp spawn claude --bind off --mode persistent --label Work",
    );
    // Option commands are Gateway slash commands: they go to a plain Gateway
    // session and name the ACP session as the target. Sent *into* the ACP
    // session (untargeted) the Gateway parser never sees them.
    expect(send).toHaveBeenCalledWith(
      "agent:main:dashboard:parent",
      "/acp permissions approve-all agent:claude:acp:abc-def",
    );
  });

  it("maps Standard/Full to approve-all and Supervised to deny-all", async () => {
    const adapter = new OpenClawAdapter();
    const send = replyToControl(
      adapter,
      "✅ Spawned ACP session agent:claude:acp:abc-def (persistent, backend acpx). Session is unbound.",
    );
    (adapter as unknown as { createGatewaySession: () => Promise<string> }).createGatewaySession = async () =>
      "agent:main:dashboard:parent";
    (adapter as unknown as { subscribeSession: () => Promise<void> }).subscribeSession = async () => undefined;
    const ensure = vi
      .spyOn(adapter, "ensureAcpxPermissionMode")
      .mockResolvedValue({ already: true, applied: false });

    await adapter.spawnAcpSession({ harnessId: "claude", permissionProfile: "default" });
    expect(ensure).toHaveBeenCalledWith("approve-all");
    // Option commands are Gateway slash commands: they go to a plain Gateway
    // session and name the ACP session as the target. Sent *into* the ACP
    // session (untargeted) the Gateway parser never sees them.
    expect(send).toHaveBeenCalledWith(
      "agent:main:dashboard:parent",
      "/acp permissions approve-all agent:claude:acp:abc-def",
    );

    send.mockClear();
    ensure.mockClear();
    await adapter.spawnAcpSession({ harnessId: "claude", permissionProfile: "approve-all" });
    expect(ensure).toHaveBeenCalledWith("approve-all");

    send.mockClear();
    ensure.mockClear();
    await adapter.spawnAcpSession({ harnessId: "claude", permissionProfile: "strict" });
    expect(ensure).toHaveBeenCalledWith("deny-all");
    expect(send).toHaveBeenCalledWith(
      "agent:main:dashboard:parent",
      "/acp permissions deny-all agent:claude:acp:abc-def",
    );
  });

  it("gives a respawned thread a new carrier label", async () => {
    /*
     * The Gateway keeps the carrier from the first spawn, and its label is a
     * unique key. A thread whose ACP session has died comes back holding that
     * dead key, so labelling the new carrier from it asked for a label the
     * Gateway already had: "label already in use: hi (2f99f2)".
     */
    const adapter = new OpenClawAdapter();
    replyToControl(
      adapter,
      "✅ Spawned ACP session agent:claude:acp:abc-def (persistent, backend acpx). Session is unbound.",
    );
    const labels: string[] = [];
    (
      adapter as unknown as {
        createGatewaySession: (input: { label: string }) => Promise<string>;
      }
    ).createGatewaySession = async (input) => {
      if (labels.includes(input.label)) throw new Error(`label already in use: ${input.label}`);
      labels.push(input.label);
      return "agent:main:dashboard:parent";
    };
    (adapter as unknown as { subscribeSession: () => Promise<void> }).subscribeSession = async () => undefined;

    const dead = "agent:claude:acp:0cc8e153-ba70-4b80-afc2-0ceaf12f99f2";
    await adapter.spawnAcpSession({ harnessId: "claude", title: "hi", sessionKey: dead });
    await expect(
      adapter.spawnAcpSession({ harnessId: "claude", title: "hi", sessionKey: dead }),
    ).resolves.toMatchObject({ sessionKey: "agent:claude:acp:abc-def" });
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("does not treat a bind-here failure as a successful Claude spawn", async () => {
    const adapter = new OpenClawAdapter();
    replyToControl(adapter, "⚠️ Conversation bindings are unavailable for webchat.");
    (adapter as unknown as { createGatewaySession: () => Promise<string> }).createGatewaySession = async () =>
      "agent:main:dashboard:parent";
    (adapter as unknown as { subscribeSession: () => Promise<void> }).subscribeSession = async () => undefined;

    await expect(adapter.spawnAcpSession({ harnessId: "claude" })).rejects.toThrow(/bindings are unavailable/i);
  });

  it("always cancels the ACP turn after aborting the Gateway run", async () => {
    const adapter = new OpenClawAdapter();
    const request = vi.fn().mockResolvedValue({});
    (adapter as unknown as { client: { request: typeof request } }).client = { request };
    const send = replyToControl(adapter, "ACP turn cancelled");

    await adapter.cancelAcp("agent:main:acp:cancel", "gateway-run");

    expect(request).toHaveBeenCalledWith("sessions.abort", {
      key: "agent:main:acp:cancel",
      runId: "gateway-run",
    });
    expect(send).toHaveBeenCalledWith("agent:main:acp:cancel", "/acp cancel");
  });

  it("maps session/request_permission onto Capsule approvals", () => {
    const adapter = new OpenClawAdapter();
    const seen: Array<{ type: string; data?: Record<string, unknown> }> = [];
    adapter.subscribeToRun("run-1", (event) => seen.push(event));
    (
      adapter as unknown as { sessionRuns: Map<string, string> }
    ).sessionRuns.set("agent:claude:acp:abc", "run-1");
    (
      adapter as unknown as {
        handleEvent: (event: { event: string; payload: Record<string, unknown> }) => void;
      }
    ).handleEvent({
      event: "agent",
      payload: {
        method: "session/request_permission",
        sessionKey: "agent:claude:acp:abc",
        requestId: "req-9",
        params: { toolCall: { kind: "edit", title: "src/index.ts" } },
      },
    });
    expect(seen[0]?.type).toBe("approval.requested");
    const approval = seen[0]?.data?.approval as { id: string; action: string; runId: string };
    expect(approval.id).toBe("req-9");
    expect(approval.runId).toBe("run-1");
    expect(approval.action).toMatch(/edit/i);
  });
});

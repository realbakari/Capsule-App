import { describe, expect, it, vi } from "vitest";
import { OpenClawAdapter } from "./adapter.js";

const key = "agent:claude:acp:reply-test";
function fixture() {
  const adapter = new OpenClawAdapter();
  const request = vi.fn().mockResolvedValue({ runId: "remote-run" });
  const internal = adapter as unknown as {
    client: { request: typeof request };
    handleEvent(event: { type: "event"; event: string; payload: unknown }): void;
    ensureAcpPermissionMode(): Promise<void>;
  };
  internal.client = { request };
  internal.ensureAcpPermissionMode = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(adapter, "ensureOperatorSession").mockResolvedValue(key);
  return { adapter, internal, request };
}

describe("persisted Gateway replies", () => {
  it("subscribes with supported parameters before sending the prompt", async () => {
    const { adapter, request } = fixture();
    await adapter.sendMessage({ sessionId: key, content: "Hello", agentId: "claude" });
    expect(request.mock.calls[0]).toEqual(["sessions.messages.subscribe", { key }]);
    expect(request.mock.calls[1]?.[0]).toBe("sessions.send");
  });

  it("does not silently send when subscription validation or authentication fails", async () => {
    const { adapter, request } = fixture();
    request.mockRejectedValue(new Error("invalid parameters: unexpected property"));
    await expect(adapter.sendMessage({ sessionId: key, content: "Hello" })).rejects.toThrow("Could not subscribe to Gateway replies");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy stream fallback only for an unavailable method", async () => {
    const { adapter, request } = fixture();
    request.mockRejectedValueOnce(new Error("unknown method: sessions.messages.subscribe"));
    await adapter.sendMessage({ sessionId: key, content: "Hello" });
    expect(request.mock.calls[1]?.[0]).toBe("sessions.send");
  });

  it("delivers whole assistant snapshots without treating them as turn completion", async () => {
    const { adapter, internal } = fixture();
    const reply = vi.fn(); const terminal = vi.fn();
    adapter.onAcpReply(reply);
    adapter.subscribeToRun("remote-run", terminal);
    const timestamp = Date.parse("2026-09-04T07:46:00Z");
    internal.handleEvent({ type: "event", event: "session.message", payload: {
      sessionKey: key, runId: "remote-run", message: { role: "assistant", timestamp, content: [{ type: "text", text: "The tests passed." }] },
    } });
    expect(reply).toHaveBeenCalledWith({ sessionKey: key, text: "The tests passed.", done: true, snapshot: true, control: false, timestamp });
    expect(terminal).not.toHaveBeenCalled();
  });

  it.each(["user", "tool", "toolResult"])("never echoes a persisted %s message as an answer", (role) => {
    const { adapter, internal } = fixture(); const reply = vi.fn(); adapter.onAcpReply(reply);
    internal.handleEvent({ type: "event", event: "session.message", payload: { sessionKey: key, message: { role, content: "Not an answer" } } });
    expect(reply).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { OpenClawAdapter } from "./adapter.js";
import { compactRunEvent, delegatedTasks, type Run, type RunEvent } from "@capsule/shared";

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
  it.each(["unknown command", "failed to spawn", "No API key found", "ACP_TURN_FAILED"])("keeps progress discussing %s as prose until a real outcome arrives", (diagnostic) => {
    const { adapter, internal } = fixture();
    const events: RunEvent[] = [];
    const replies = vi.fn();
    adapter.subscribeToRun("remote-run", (event) => events.push(event));
    adapter.onAcpReply(replies);
    const progress = `The log says ${diagnostic}. I will fix it.`;
    internal.handleEvent({ type: "event", event: "agent", payload: { runId: "remote-run", sessionKey: key, stream: "assistant", text: progress } });
    expect(events.map((event) => event.type)).toEqual(["assistant"]);
    expect(replies).toHaveBeenLastCalledWith(expect.objectContaining({ text: progress, done: false }));
    internal.handleEvent({ type: "event", event: "agent", payload: { runId: "remote-run", sessionKey: key, status: "ok", text: "Fixed." } });
    expect(events.at(-1)).toMatchObject({ type: "lifecycle", data: { status: "completed", output: "Fixed." } });
  });

  it.each([
    { fields: { status: "error", text: "Disconnected" }, status: "failed" },
    { fields: { phase: "error", text: "Disconnected" }, status: "failed" },
    { fields: { state: "error", text: "Disconnected" }, status: "failed" },
    { fields: { state: "aborted" }, status: "cancelled" },
    { fields: { state: "final", status: "error", text: "Disconnected" }, status: "failed" },
    { fields: { stream: "lifecycle", data: { phase: "error", text: "Disconnected" } }, status: "failed" },
    { fields: { stream: "lifecycle", data: { phase: "end" } }, status: "completed" },
    { fields: { text: "AcpRuntimeError [ACP_TURN_FAILED]: Authentication required" }, status: "failed" },
  ])("keeps terminal outcome $status for $fields", ({ fields, status }) => {
    for (const event of ["agent", "chat"]) {
      const { adapter, internal } = fixture();
      const events: RunEvent[] = [];
      const replies = vi.fn();
      adapter.subscribeToRun("remote-run", (value) => events.push(value));
      adapter.onAcpReply(replies);
      internal.handleEvent({ type: "event", event, payload: { runId: "remote-run", sessionKey: key, ...fields } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "lifecycle", data: { status } });
      if (status !== "completed") {
        expect(events[0]?.data?.output).toBeUndefined();
        expect(replies).toHaveBeenLastCalledWith(expect.objectContaining({ done: true, text: undefined }));
      }
    }
  });

  it("keeps command failures and thinking in diagnostics without failing the parent or leaking prose", () => {
    const { adapter, internal } = fixture();
    const events: RunEvent[] = [];
    const replies = vi.fn();
    adapter.subscribeToRun("remote-run", (event) => events.push(event));
    adapter.onAcpReply(replies);
    for (const stream of ["thinking", "command_output"]) {
      internal.handleEvent({ type: "event", event: "agent", payload: { runId: "remote-run", sessionKey: key, stream, text: "ACP_TURN_FAILED: reported by the command" } });
    }
    internal.handleEvent({ type: "event", event: "agent", payload: { runId: "remote-run", sessionKey: key, stream: "acp", data: {
      phase: "runtime_event", eventType: "tool_call_update", status: "error", text: "ACP_TURN_FAILED: reported by the command",
    } } });
    expect(events.map((event) => event.type)).toEqual(["thinking", "command", "tool"]);
    expect(replies).not.toHaveBeenCalled();
  });

  it("does not complete an active turn when a control status request finishes", async () => {
    const { adapter, internal } = fixture();
    const terminal = vi.fn();
    adapter.subscribeToRun("remote-run", terminal);
    vi.spyOn(adapter, "sendSlash").mockImplementation(async () => {
      internal.handleEvent({ type: "event", event: "agent", payload: {
        runId: "remote-run", sessionKey: key, status: "ok", text: "ACP status: working",
      } });
    });
    await expect(adapter.acpCommand(key, "/acp status")).resolves.toMatchObject({ text: "ACP status: working" });
    expect(terminal).not.toHaveBeenCalled();
  });

  it.each(["agent", "session.message"])("keeps %s control errors recoverable without failing the parent", async (event) => {
    const { adapter, internal } = fixture();
    const terminal = vi.fn();
    adapter.subscribeToRun("remote-run", terminal);
    const text = "AcpRuntimeError [ACP_TURN_FAILED]: Authentication required";
    vi.spyOn(adapter, "sendSlash").mockImplementation(async () => {
      const body = event === "session.message" ? { message: { role: "assistant", content: text } } : { status: "error", text };
      internal.handleEvent({ type: "event", event, payload: { runId: "remote-run", sessionKey: key, ...body } });
    });
    await expect(adapter.acpCommand(key, "/acp status")).rejects.toThrow("Authentication required");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("preserves structured task details separately from parent lifecycle and bounded diagnostics", () => {
    const { adapter, internal } = fixture();
    const received: RunEvent[] = [];
    adapter.subscribeToRun("remote-run", (event) => { received.push(compactRunEvent(event)); });
    internal.handleEvent({ type: "event", event: "agent", payload: { runId: "remote-run", sessionKey: key, stream: "acp", data: {
      phase: "runtime_event", eventType: "tool_call", toolCallId: "task", title: "Agent", status: "completed",
      rawInput: { prompt: "x".repeat(100000), subagent_type: "reviewer", description: "Review changes" }, rawOutput: { usage: { total_tokens: 123 } },
    } } });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("tool");
    expect(received[0]?.data?.status).toBeUndefined();
    expect(delegatedTasks({ id: "remote-run", sessionId: "s" } as Run, received)[0]).toMatchObject({ title: "Review changes", status: "completed", totalTokens: 123 });
  });
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

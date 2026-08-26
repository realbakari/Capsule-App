import { describe, expect, it } from "vitest";
import { classifyAgentStream, classifyRuntimeEvent, extractGatewayText, isAssistantProse } from "./events.js";

describe("classifyAgentStream", () => {
  it("keeps reasoning separate from prose", () => {
    // These are the values the Gateway actually emits on agent frames.
    for (const stream of ["thought", "thinking", "reasoning"]) {
      expect(classifyAgentStream(stream)).toBe("thinking");
    }
    expect(classifyAgentStream("assistant")).toBe("message");
  });

  it("classifies the remaining gateway streams", () => {
    expect(classifyAgentStream("plan")).toBe("plan");
    expect(classifyAgentStream("tool")).toBe("tool");
    expect(classifyAgentStream("item")).toBe("tool");
    expect(classifyAgentStream("command_output")).toBe("command");
    expect(classifyAgentStream("stdout")).toBe("command");
    expect(classifyAgentStream("stderr")).toBe("command");
    expect(classifyAgentStream("patch")).toBe("patch");
    expect(classifyAgentStream("error")).toBe("error");
    expect(classifyAgentStream("compaction")).toBe("lifecycle");
  });

  it("handles prefixed variants the gateway may add later", () => {
    expect(classifyAgentStream("tool_call_update")).toBe("tool");
    expect(classifyAgentStream("reasoning_summary_text")).toBe("thinking");
  });

  it("falls back to message for unknown or empty streams", () => {
    expect(classifyAgentStream("something_new")).toBe("message");
    expect(classifyAgentStream(undefined)).toBe("message");
    expect(classifyAgentStream("  ")).toBe("message");
  });

  it("is case and whitespace tolerant", () => {
    expect(classifyAgentStream("  THOUGHT ")).toBe("thinking");
  });
});

describe("isAssistantProse", () => {
  it("admits only prose into the assistant reply", () => {
    expect(isAssistantProse("message")).toBe(true);
    // The regression: these used to be concatenated into run.result, so
    // reasoning and command output leaked into the agent's visible answer.
    for (const kind of ["thinking", "plan", "tool", "command", "patch", "error"] as const) {
      expect(isAssistantProse(kind)).toBe(false);
    }
  });
});

describe("ACP runtime frames", () => {
  /*
   * Real frames from a live session. The outer stream is always "acp"; the
   * kind and the text both live one level down, which is why the execution log
   * filled with hundreds of empty rows.
   */
  const toolCall = {
    stream: "acp",
    data: {
      phase: "runtime_event", eventType: "tool_call", tag: "tool_call",
      text: "Edit (pending)", title: "Edit", status: "pending",
    },
  };
  const usage = {
    stream: "acp",
    data: { phase: "runtime_event", eventType: "status", tag: "usage_update", text: "usage updated: 80025/200000" },
  };
  const textDelta = { stream: "acp", data: { phase: "runtime_event", eventType: "text_delta", stream: "output" } };

  it("pulls text out of the nested payload", () => {
    expect(extractGatewayText(toolCall)).toBe("Edit (pending)");
    expect(extractGatewayText(usage)).toBe("usage updated: 80025/200000");
  });

  it("falls back to the title when a frame has no text", () => {
    expect(extractGatewayText({ stream: "acp", data: { eventType: "tool_call", title: "Edit" } })).toBe("Edit");
  });

  it("classifies by nested eventType, not the outer stream", () => {
    expect(classifyRuntimeEvent(toolCall)).toBe("tool");
    expect(classifyRuntimeEvent({ stream: "acp", data: { eventType: "error" } })).toBe("error");
  });

  it("treats telemetry and typing ticks as lifecycle, not activity", () => {
    // text_delta carries no text at all — the reply arrives on another path.
    expect(classifyRuntimeEvent(textDelta)).toBe("lifecycle");
    expect(classifyRuntimeEvent(usage)).toBe("lifecycle");
  });

  it("returns undefined for a non-runtime frame so the outer stream decides", () => {
    expect(classifyRuntimeEvent({ stream: "assistant" })).toBeUndefined();
  });

  it("leaves top-level frames working as before", () => {
    expect(extractGatewayText({ text: "plain" })).toBe("plain");
  });
});

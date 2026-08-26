import { describe, expect, it } from "vitest";
import { classifyAgentStream, isAssistantProse } from "./events.js";

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

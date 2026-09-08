import { describe, expect, it, vi } from "vitest";
import { TerminalOutputFlow } from "./output-flow.js";

function fixture() {
  const handlers = { data: vi.fn(), pause: vi.fn(), resume: vi.fn(), drained: vi.fn(), overflow: vi.fn() };
  return { handlers, flow: new TerminalOutputFlow(handlers, 40_000, 10_000, 100_000) };
}

describe("terminal output flow", () => {
  it("waits for renderer readiness and ignores stale or forged acknowledgements", () => {
    const { flow, handlers } = fixture();
    flow.push("prompt"); flow.acknowledge(99);
    expect(handlers.data).not.toHaveBeenCalled();
    flow.acknowledge(0); flow.push("next"); flow.acknowledge(0); flow.acknowledge(99);
    expect(handlers.data).toHaveBeenCalledTimes(1);
    flow.acknowledge(1);
    expect(handlers.data).toHaveBeenLastCalledWith("next", 2);
  });

  it("pauses a noisy producer, preserves order and drains before exit", () => {
    const { flow, handlers } = fixture();
    const original = "\u001b[31m" + "x".repeat(70_000) + "\u001b[0m";
    flow.push(original); flow.end();
    expect(handlers.pause).toHaveBeenCalledTimes(1);
    flow.acknowledge(0);
    while (flow.retainedBytes) {
      expect(handlers.drained).not.toHaveBeenCalled();
      flow.acknowledge(handlers.data.mock.calls.at(-1)![1]);
    }
    expect(handlers.data.mock.calls.map(([text]) => text).join("")).toBe(original);
    expect(handlers.resume).toHaveBeenCalledTimes(1);
    expect(handlers.drained).toHaveBeenCalledTimes(1);
  });

  it("keeps emoji pairs and all output intact across frame boundaries", () => {
    const { flow, handlers } = fixture();
    const original = "x".repeat(16_383) + String.fromCodePoint(0x1f30d) + "end";
    flow.push(original); flow.acknowledge(0); flow.acknowledge(1);
    expect(handlers.data.mock.calls.map(([text]) => text).join("")).toBe(original);
    expect(handlers.data.mock.calls[0]![0]).toHaveLength(16_383);
  });

  it("fails explicitly at its hard bound instead of dropping ANSI fragments", () => {
    const { flow, handlers } = fixture();
    flow.push("x".repeat(100_001)); flow.acknowledge(0);
    expect(flow.retainedBytes).toBe(0);
    expect(handlers.overflow).toHaveBeenCalledTimes(1);
    expect(handlers.data).not.toHaveBeenCalled();
  });
});

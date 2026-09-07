import { afterEach, expect, it, vi } from "vitest";
import { TextBudget } from "@capsule/shared";
import { ResultWriter } from "./result-writer.js";

afterEach(() => vi.useRealTimers());

it("coalesces tiny deltas and flushes the last tail without scanning history", () => {
  vi.useFakeTimers();
  const budget = new TextBudget();
  const save = vi.fn();
  const writer = new ResultWriter(budget, save);
  for (let i = 0; i < 100_000; i++) writer.append("a", "x");
  expect(save).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(save).toHaveBeenLastCalledWith("a", "x".repeat(100_000));
  writer.append("b", "small reply");
  writer.finishAll();
  expect(save).toHaveBeenLastCalledWith("b", "small reply");
  expect(budget.retainedBytes).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps completed messages authoritative and bounds their combined result", () => {
  const budget = new TextBudget(20);
  const writer = new ResultWriter(budget, vi.fn());
  writer.append("a", "First ");
  const first = writer.recordReply("a", "First answer");
  writer.append("a", "late duplicate tokens");
  expect(writer.recordReply("a", "Second", first)).toBe("First answer\nSecond");
  expect(() => writer.recordReply("a", "Too much", budget.text("run:a"))).toThrow("reply limit");
  expect(writer.finish("a")).toBe("First answer\nSecond");
  expect(budget.retainedBytes).toBe(0);
});

import { describe, expect, it } from "vitest";
import { TextBudget } from "./text-budget.js";

describe("retained reply budget", () => {
  it("counts UTF-8 bytes and leaves the previous value intact on rejection", () => {
    const budget = new TextBudget(8, 12, 2);
    budget.append("a", "🐈");
    budget.append("b", "abcd");
    expect(budget.retainedBytes).toBe(8);
    expect(() => budget.append("a", "🐈🐈🐈", true)).toThrow("reply limit");
    expect(budget.text("a")).toBe("🐈");
    budget.append("a", "🐈");
    expect(() => budget.append("b", "x")).toThrow("reply limit");
    expect(budget.take("a")).toBe("🐈🐈");
    expect(budget.retainedBytes).toBe(4);
    budget.append("c", "z");
    expect(() => budget.append("d", "z")).toThrow("reply limit");
    budget.clear();
    expect(budget.retainedBytes).toBe(0);
  });

  it("preserves order across many tiny deltas and releases replaced snapshots", () => {
    const budget = new TextBudget();
    const text = "0123456789".repeat(10_000);
    for (const letter of text) budget.append("turn", letter);
    expect(budget.text("turn")).toBe(text);
    budget.append("turn", "Final", true);
    expect(budget.retainedBytes).toBe(5);
    budget.append("turn", "", true);
    expect(budget.retainedBytes).toBe(0);
  });
});

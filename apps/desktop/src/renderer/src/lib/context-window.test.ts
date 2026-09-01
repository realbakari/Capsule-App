import { describe, expect, it } from "vitest";
import {
  contextTone,
  formatTokens,
  latestContextUsage,
  parseContextUsage,
} from "./context-window.js";

describe("parseContextUsage", () => {
  it("reads the line the harness actually emits", () => {
    // Verbatim from a real session record.
    expect(parseContextUsage("usage updated: 87690/200000")).toEqual({
      used: 87690,
      limit: 200000,
      fraction: 87690 / 200000,
    });
  });

  it("survives the wording drifting a little", () => {
    expect(parseContextUsage("Usage updated 1000 / 2000")?.used).toBe(1000);
    expect(parseContextUsage("usage updated: 1,000/2,000")?.used).toBe(1000);
  });

  it("finds the reading inside a longer frame", () => {
    expect(parseContextUsage("tool call (completed) usage updated: 5/10 more")?.fraction).toBe(0.5);
  });

  it("returns nothing for text that has no reading", () => {
    expect(parseContextUsage("tool call (completed)")).toBeUndefined();
    expect(parseContextUsage(undefined)).toBeUndefined();
    expect(parseContextUsage("")).toBeUndefined();
  });

  it("refuses a zero limit rather than dividing by it", () => {
    expect(parseContextUsage("usage updated: 5/0")).toBeUndefined();
  });

  it("clamps a provider reporting past its own limit", () => {
    expect(parseContextUsage("usage updated: 300/200")?.fraction).toBe(1);
  });

  it("accepts a fresh session at zero", () => {
    // "usage updated: 0/200000" appears at the start of a real session.
    expect(parseContextUsage("usage updated: 0/200000")?.fraction).toBe(0);
  });
});

describe("latestContextUsage", () => {
  it("takes the most recent reading", () => {
    expect(
      latestContextUsage(["usage updated: 10/100", "tool call", "usage updated: 40/100"])?.used,
    ).toBe(40);
  });

  it("skips lines that carry no reading", () => {
    expect(latestContextUsage(["usage updated: 10/100", "tool call", undefined])?.used).toBe(10);
  });

  it("returns nothing when no line has one", () => {
    expect(latestContextUsage(["a", "b"])).toBeUndefined();
    expect(latestContextUsage([])).toBeUndefined();
  });
});

describe("formatTokens", () => {
  it("keeps the label short", () => {
    expect(formatTokens(200000)).toBe("200k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(842)).toBe("842");
  });
});

describe("contextTone", () => {
  it("warns only where it is actionable", () => {
    expect(contextTone(0.5)).toBe("normal");
    expect(contextTone(0.75)).toBe("warn");
    expect(contextTone(0.95)).toBe("critical");
  });
});

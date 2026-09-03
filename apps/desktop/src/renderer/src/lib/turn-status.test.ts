import { describe, expect, it } from "vitest";
import { formatDuration } from "./turns";
import { formatTokens, parseContextUsage } from "./context-window";

describe("what a turn-in-flight line says", () => {
  it("reads the token count out of the harness's own activity text", () => {
    // The harness reports "usage updated: 12900/200000"; the line shows the
    // used half and keeps the whole ratio for the tooltip.
    const usage = parseContextUsage("usage updated: 12900/200000");
    expect(usage).toBeDefined();
    expect(`${formatTokens(usage!.used)} tokens`).toBe("13k tokens");
    expect(`${formatTokens(usage!.used)} of ${formatTokens(usage!.limit)} context`).toBe(
      "13k of 200k context",
    );
  });

  it("counts the wait in a form someone reads at a glance", () => {
    expect(formatDuration(763_000)).toBe("12m 43s");
  });
});

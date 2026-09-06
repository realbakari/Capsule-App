import { describe, expect, it } from "vitest";
import { PerformanceTimings } from "./performance.js";

describe("local timings", () => {
  it("bounds samples and preserves slow outliers without storing payloads", () => {
    const timings = new PerformanceTimings();
    timings.record("git.process", 4000, true);
    for (let i = 0; i < 10000; i++) timings.record("events.renderer", 1);
    const result = timings.snapshot();
    expect(result.recent).toHaveLength(200);
    expect(result.slowest).toHaveLength(20);
    expect(result.slowest[0]?.milliseconds).toBe(4000);
    expect(result.totals.find((item) => item.operation === "git.process")?.failures).toBe(1);
    result.totals[0]!.count = 0;
    expect(timings.snapshot().totals[0]?.count).toBe(1);
  });
  it("records a measurement once and ignores invalid durations", () => {
    const timings = new PerformanceTimings();
    const end = timings.start("preview.read"); end(); end(true);
    timings.record("preview.read", NaN); timings.record("preview.read", -1);
    expect(timings.snapshot().recent).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { boundRunEvents, compactRunEvent, LIVE_EVENT_BYTES, runEventBytes } from "./run-events.js";
import type { RunEvent } from "./types.js";

const event = (id: number, data?: RunEvent["data"]): RunEvent => ({ id: String(id), runId: "r", type: "tool", timestamp: String(id).padStart(8, "0"), message: "Tool result", data });
describe("bounded diagnostic events", () => {
  it("caps strings and wide numeric trees and discloses truncation", () => {
    const numbers = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => Array(32).fill(123456)));
    const raw = event(1, { numbers, output: "x".repeat(2_000_000) });
    const bounded = compactRunEvent(raw);
    expect(bounded.data?.payloadTruncated).toBe(true);
    expect(runEventBytes(bounded)).toBeLessThan(40_000);
    expect(compactRunEvent(raw)).toBe(bounded);
    expect(raw.data?.output).toHaveLength(2_000_000);
  });
  it("keeps recent events within both limits and marks earlier history", () => {
    const events = Array.from({ length: 50_000 }, (_, i) => event(i));
    const window = boundRunEvents(events);
    expect(window).toHaveLength(1000);
    expect(window[0]?.data?.earlierEvents).toBe(true);
    expect(window.at(-1)?.id).toBe("49999");
    const large = Array.from({ length: 1000 }, (_, i) => compactRunEvent(event(i, { output: "x".repeat(100_000) })));
    const bytes = boundRunEvents(large).reduce((sum, row) => sum + runEventBytes(row), 0);
    expect(bytes).toBeLessThanOrEqual(LIVE_EVENT_BYTES);
  });
});

import { describe, expect, it } from "vitest";
import { readMuseSubscriptionUsage } from "./provider-usage.js";

describe("reported subscription usage", () => {
  const valid = { observedAtMs: 1_800_000_000_000, tier: "standard",
    window: { usedPercent: 0, resetsAtMs: 1_800_018_000_000, windowDurationMins: 300 },
    weekly: { usedPercent: 125, resetsAtMs: 1_800_604_800_000 } };
  it("preserves zero, over-quota values and future observations without interpretation", () => {
    expect(readMuseSubscriptionUsage(valid)).toEqual({ ...valid, providerId: "muse" });
    expect(readMuseSubscriptionUsage({ ...valid, observedAtMs: 0 })?.observedAtMs).toBe(0);
  });
  it("rejects missing, fractional, negative and non-finite quota values", () => {
    for (const value of [null, {}, [], { ...valid, weekly: undefined }]) expect(readMuseSubscriptionUsage(value)).toBeUndefined();
    for (const usedPercent of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(readMuseSubscriptionUsage({ ...valid, window: { ...valid.window, usedPercent } })).toBeUndefined();
    }
    for (const windowDurationMins of [0, -1, 1.5, Infinity]) {
      expect(readMuseSubscriptionUsage({ ...valid, window: { ...valid.window, windowDurationMins } })).toBeUndefined();
    }
    for (const stamp of [-1, NaN, Infinity, 8.64e15 + 1]) {
      expect(readMuseSubscriptionUsage({ ...valid, observedAtMs: stamp })).toBeUndefined();
      expect(readMuseSubscriptionUsage({ ...valid, weekly: { ...valid.weekly, resetsAtMs: stamp } })).toBeUndefined();
    }
  });
  it("bounds labels and excludes arbitrary wire fields", () => {
    const report = readMuseSubscriptionUsage({ ...valid, tier: "\u001b[31mStandard\u202e\n", secret: "discard", accountId: "discard", providerId: "invented" });
    expect(report?.tier).toBe("Standard");
    expect(report).not.toHaveProperty("secret");
    expect(report).not.toHaveProperty("accountId");
    expect(report?.providerId).toBe("muse");
    expect(readMuseSubscriptionUsage({ ...valid, tier: "x".repeat(10_000) })?.tier.length).toBeLessThanOrEqual(100);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ProviderSubscriptionUsage } from "@capsule/shared";
import { ProviderQuotaCard, quotaObservationLabel } from "./ProviderQuota";

const now = Date.UTC(2026, 8, 20);
const report: ProviderSubscriptionUsage = { providerId: "muse", tier: "standard", observedAtMs: now,
  window: { usedPercent: 0, resetsAtMs: now + 10_000, windowDurationMins: 300 },
  weekly: { usedPercent: 125, resetsAtMs: now - 1 } };

it("labels old and future observations without inventing a fresh measurement", () => {
  expect(quotaObservationLabel(report, now)).toBe("Reported observation");
  expect(quotaObservationLabel(report, now + 300_001)).toContain("out of date");
  expect(quotaObservationLabel(report, now, true)).toContain("out of date");
  expect(quotaObservationLabel(report, now - 300_001)).toContain("clock differs");
});

it("keeps exact percentages in text and accessibility while clamping the visual bar", () => {
  const html = renderToStaticMarkup(createElement(ProviderQuotaCard, { source: { sessionId: "one", title: "Source thread", report }, now }));
  expect(html).toContain("0% used");
  expect(html).toContain("125% used");
  expect(html).toContain('aria-valuenow="100"');
  expect(html).toContain('aria-valuetext="125% used"');
  expect(html).toContain("width:100%");
  expect(html).toContain("Reset time passed; awaiting a new report");
  expect(html).toContain("Source thread");
  expect(html).toContain("5-hour window");
});

it("marks a window near its limit in words and colour, with the even-use tick inside the window", () => {
  const near: ProviderSubscriptionUsage = { ...report, window: { usedPercent: 84, resetsAtMs: now + 125 * 60_000, windowDurationMins: 300 },
    weekly: { usedPercent: 41, resetsAtMs: now + 3 * 86_400_000 } };
  const html = renderToStaticMarkup(createElement(ProviderQuotaCard, { source: { sessionId: "one", title: "Source thread", report: near }, now }));
  expect(html).toContain("84% used · near limit");
  expect(html).toContain('data-tone="near"');
  expect(html).toContain("Resets in 2h 05m");
  expect(html).toContain("left:58%");
  expect(html).not.toContain("41% used ·");
});

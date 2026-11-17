import { describe, expect, it } from "vitest";
import { compactTokens, countdown, dailySeries, dayKey, limitTone, niceCeiling, pacePercent, projectRows, resetText, share, type UsageBucket } from "./usage-model";

const now = new Date(2026, 10, 17, 15, 0).getTime();
const DAY = 86_400_000;

it("draws every day in the range, so idle days keep their place on the axis", () => {
  const byDay: UsageBucket[] = [
    { key: dayKey(now - 5 * DAY), totals: { input: 10, output: 5 }, requests: 2 },
    { key: dayKey(now), totals: { cachedInput: 100 }, requests: 1 },
  ];
  const points = dailySeries(byDay, 7, now);
  expect(points.map((point) => point.key)).toEqual([6, 5, 4, 3, 2, 1, 0].map((back) => dayKey(now - back * DAY)));
  expect(points.map((point) => point.tokens)).toEqual([0, 15, 0, 0, 0, 0, 100]);
  expect(points.at(-1)?.requests).toBe(1);
});

it("rounds the chart ceiling to a number an axis can print", () => {
  expect(niceCeiling(0)).toBe(1);
  expect(niceCeiling(59_500_000)).toBe(100_000_000);
  expect(niceCeiling(180)).toBe(200);
  expect(niceCeiling(2_400)).toBe(2_500);
  expect(niceCeiling(5_000)).toBe(5_000);
});

it("warns near a limit and says when it is reached, never before", () => {
  expect(limitTone(79)).toBe("ok");
  expect(limitTone(80)).toBe("near");
  expect(limitTone(100)).toBe("over");
  expect(limitTone(125)).toBe("over");
});

it("places even use from the reset time and window length, and only inside the window", () => {
  expect(pacePercent(now + 125 * 60_000, 300, now)).toBe(58);
  expect(pacePercent(now - 1, 300, now)).toBeUndefined();
  expect(pacePercent(now + 400 * 60_000, 300, now)).toBeUndefined();
});

it("counts down to a reset and stops claiming one once it has passed", () => {
  expect(countdown(125 * 60_000)).toBe("2h 05m");
  expect(countdown(30_000)).toBe("1m");
  expect(countdown(3 * DAY + 5 * 3_600_000)).toBe("3d 5h");
  expect(resetText(now + 125 * 60_000, now)).toMatch(/^Resets in 2h 05m · /);
  expect(resetText(now, now)).toBe("Reset time passed; awaiting a new report");
});

it("keeps units compact without trailing zeros, and never rounds real use to 0%", () => {
  expect(compactTokens(17_000_000)).toBe("17M");
  expect(compactTokens(786_300_000)).toBe("786.3M");
  expect(compactTokens(2_000_000_000)).toBe("2B");
  expect(compactTokens(950)).toBe("950");
  expect(share(1, 10_000)).toBe("<0.1%");
  expect(share(0, 10)).toBe("0%");
});

describe("projectRows", () => {
  const bucket = (key: string, input: number) => ({ key, totals: { input }, requests: 1 });
  it("names projects, calls the rest Other folders, and folds a long tail", () => {
    const names = new Map([["a", "App"], ["b", "Site"]]);
    expect(projectRows([bucket("a", 50), bucket("", 30), bucket("gone", 10)], names).map((row) => row.label)).toEqual(["App", "Other folders", "Removed project"]);
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((key, index) => bucket(key, 70 - index));
    const rows = projectRows(many, names, 4);
    expect(rows.map((row) => row.label)).toEqual(["App", "Site", "Removed project", "4 more"]);
    expect(rows.at(-1)).toMatchObject({ tokens: 67 + 66 + 65 + 64, requests: 4 });
  });
});

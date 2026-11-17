import { describe, expect, it } from "vitest";
import { formatClock, formatFullStamp, formatStamp } from "./display-prefs";

describe("formatClock", () => {
  const evening = new Date(2026, 10, 14, 21, 5);
  it("forces a 24-hour clock", () => {
    expect(formatClock(evening, "24h")).toMatch(/^21[:.]05/);
  });
  it("forces a 12-hour clock", () => {
    expect(formatClock(evening, "12h")).toMatch(/9[:.]05/);
    expect(formatClock(evening, "12h")).toMatch(/pm/i);
  });
  it("says nothing for an unreadable time", () => {
    expect(formatClock("not a date", "24h")).toBe("");
  });
});

describe("formatStamp", () => {
  const now = new Date(2026, 10, 17, 9, 0);
  it("shows only the time for today", () => {
    expect(formatStamp(new Date(2026, 10, 17, 8, 30), now, "24h")).toMatch(/^08[:.]30$/);
  });
  it("names yesterday by calendar day, even under a day ago", () => {
    expect(formatStamp(new Date(2026, 10, 16, 23, 50), now, "24h")).toMatch(/^Yesterday 23[:.]50$/);
  });
  it("names the weekday within the week", () => {
    const monday = new Date(2026, 10, 16 - 3, 10, 42);
    const weekday = monday.toLocaleDateString([], { weekday: "short" });
    expect(formatStamp(monday, now, "24h")).toBe(`${weekday} ${formatClock(monday, "24h")}`);
  });
  it("gives a date a week or more back, with the year only when it differs", () => {
    const older = new Date(2026, 9, 3, 10, 42);
    expect(formatStamp(older, now, "24h")).not.toMatch(/2026/);
    expect(formatStamp(older, now, "24h")).toContain(formatClock(older, "24h"));
    expect(formatStamp(new Date(2025, 9, 3, 10, 42), now, "24h")).toMatch(/2025/);
  });
  it("says nothing for an unreadable time", () => {
    expect(formatStamp("not a date", now)).toBe("");
    expect(formatFullStamp("not a date")).toBe("");
  });
  it("spells out the full date for a tooltip", () => {
    expect(formatFullStamp(new Date(2025, 9, 3, 10, 42), "24h")).toMatch(/2025/);
  });
});

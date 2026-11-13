import { describe, expect, it } from "vitest";
import { formatClock } from "./display-prefs";

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

import { describe, expect, it } from "vitest";
import { detectUsageLimit, formatResetTime } from "./usage-limit.js";

const now = new Date("2026-10-12T10:00:00");

describe("detectUsageLimit", () => {
  it("ignores failures that are not about allowance", () => {
    expect(detectUsageLimit("ENOENT: claude not found", now)).toEqual({ limited: false });
    expect(detectUsageLimit(undefined, now)).toEqual({ limited: false });
  });

  it("does not read a clock time out of ordinary words", () => {
    // "chat 4" once parsed as "at 4", scheduling a resend at 04:00.
    expect(detectUsageLimit("Usage limit reached for this chat 4 times today.", now)).toEqual({ limited: true });
    expect(detectUsageLimit("Rate limit hit; using fallback 2 of 3.", now)).toEqual({ limited: true });
  });

  it("is not fooled by a disk quota", () => {
    expect(detectUsageLimit("EDQUOT: Disk quota exceeded", now)).toEqual({ limited: false });
    expect(detectUsageLimit("You exceeded your current quota.", now).limited).toBe(true);
  });

  it("reads a UTC clock time as UTC", () => {
    const resetsAt = detectUsageLimit("Usage limit reached. Resets at 23:30 UTC.", now).resetsAt!;
    expect(resetsAt.getUTCHours()).toBe(23);
    expect(resetsAt.getUTCMinutes()).toBe(30);
    expect(resetsAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("recognises a limit without a time", () => {
    expect(detectUsageLimit("Rate limit exceeded for this organisation.", now)).toEqual({ limited: true });
  });

  it("reads relative waits in seconds, minutes, hours and combinations", () => {
    expect(detectUsageLimit("Usage limit reached. Try again in 30 minutes.", now).resetsAt).toEqual(new Date("2026-10-12T10:30:00"));
    expect(detectUsageLimit("rate limit: retry after 90 seconds", now).resetsAt).toEqual(new Date("2026-10-12T10:01:30"));
    expect(detectUsageLimit("Session limit hit; resets in 2 hours and 15 min", now).resetsAt).toEqual(new Date("2026-10-12T12:15:00"));
  });

  it("reads clock times, rolling to tomorrow when the time has passed", () => {
    expect(detectUsageLimit("You've hit your usage limit. Resets at 3pm.", now).resetsAt).toEqual(new Date("2026-10-12T15:00:00"));
    expect(detectUsageLimit("quota exhausted until 9:30am", now).resetsAt).toEqual(new Date("2026-10-13T09:30:00"));
  });

  it("reads an ISO timestamp", () => {
    expect(detectUsageLimit("usage limit; resets 2026-10-12T14:00:00Z", now).resetsAt).toEqual(new Date("2026-10-12T14:00:00Z"));
  });

  it("formats a reset time for today as a clock, otherwise with the day", () => {
    expect(formatResetTime(new Date("2026-10-12T15:00:00"), now)).toMatch(/3:00/);
    expect(formatResetTime(new Date("2026-10-13T09:30:00"), now)).toMatch(/Tue/);
  });
});

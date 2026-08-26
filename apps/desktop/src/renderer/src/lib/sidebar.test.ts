import { describe, expect, it } from "vitest";
import {
  compactRelativeTime,
  formatWorkingDurationLabel,
  resolveSidebarThreadKind,
  shouldRecedeThread,
  splitProjectThreads,
} from "./sidebar.js";

describe("sidebar thread status", () => {
  it("treats approval as the attention state", () => {
    expect(resolveSidebarThreadKind({ liveHarness: true, runStatus: "approval_required" })).toBe(
      "approval",
    );
  });

  it("marks a live harness or running turn as working", () => {
    expect(resolveSidebarThreadKind({ liveHarness: true })).toBe("working");
    expect(resolveSidebarThreadKind({ liveHarness: false, runStatus: "running" })).toBe("working");
  });

  it("recedes settled rows only", () => {
    expect(shouldRecedeThread("ready", false)).toBe(true);
    expect(shouldRecedeThread("working", false)).toBe(false);
    expect(shouldRecedeThread("approval", false)).toBe(false);
    expect(shouldRecedeThread("ready", true)).toBe(false);
  });

  it("does not treat an idle persistent harness as working", () => {
    expect(resolveSidebarThreadKind({ liveHarness: false, runStatus: "completed" })).toBe("ready");
  });
});

describe("sidebar time labels", () => {
  it("compacts relative time", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    expect(compactRelativeTime("2026-08-26T11:59:30.000Z", now)).toBe("now");
    expect(compactRelativeTime("2026-08-26T11:10:00.000Z", now)).toBe("50m");
    expect(compactRelativeTime("2026-08-25T12:00:00.000Z", now)).toBe("1d");
  });

  it("formats a working duration", () => {
    expect(formatWorkingDurationLabel(4_000)).toBe("4s");
    expect(formatWorkingDurationLabel(125_000)).toBe("2m");
    expect(formatWorkingDurationLabel(3_700_000)).toBe("1h 1m");
  });
});

describe("splitProjectThreads", () => {
  it("keeps pinned and live rows out of the settled tail", () => {
    const threads = [
      { id: "p", pinned: true, updatedAt: "2026-08-26T10:00:00.000Z" },
      { id: "w", updatedAt: "2026-08-26T11:00:00.000Z" },
      { id: "a", updatedAt: "2026-08-26T11:30:00.000Z" },
      { id: "s", updatedAt: "2026-08-20T11:00:00.000Z" },
    ];
    const split = splitProjectThreads(threads, (thread) => {
      if (thread.id === "w") return "working";
      if (thread.id === "a") return "approval";
      return "ready";
    });
    expect(split.pinned.map((item) => item.id)).toEqual(["p"]);
    expect(split.live.map((item) => item.id)).toEqual(["w", "a"]);
    expect(split.rest.map((item) => item.id)).toEqual(["s"]);
  });
});

import { describe, expect, it } from "vitest";
import { shouldFollowLatest, shouldRestComposer } from "./composer-rest";

describe("composer rest", () => {
  it("rests only while reading history, not at the live edge", () => {
    expect(shouldRestComposer({ awayFromLatest: true, blocking: false, multiline: false })).toBe(true);
    expect(shouldRestComposer({ awayFromLatest: false, blocking: false, multiline: false })).toBe(false);
  });

  it("stays compact while focused, and expands for a picker, newline, or attachments", () => {
    const away = { awayFromLatest: true, blocking: false, multiline: false };
    expect(shouldRestComposer(away)).toBe(true);
    expect(shouldRestComposer({ ...away, blocking: true })).toBe(false);
    expect(shouldRestComposer({ ...away, multiline: true })).toBe(false);
    expect(shouldRestComposer({ ...away, hasAttachments: true })).toBe(false);
    expect(shouldRestComposer({ ...away, hasSkill: true })).toBe(false);
  });
});

describe("follow latest", () => {
  it("leaves the live edge after a short scroll up", () => {
    expect(shouldFollowLatest({ following: true, distanceFromBottom: 0, scrollDelta: 0 })).toBe(true);
    expect(shouldFollowLatest({ following: true, distanceFromBottom: 12, scrollDelta: -12 })).toBe(true);
    expect(shouldFollowLatest({ following: true, distanceFromBottom: 40, scrollDelta: -40 })).toBe(false);
  });

  it("does not rejoin just because rest changed layout height", () => {
    expect(shouldFollowLatest({ following: false, distanceFromBottom: 0, scrollDelta: 0 })).toBe(false);
    expect(shouldFollowLatest({ following: false, distanceFromBottom: 8, scrollDelta: -2 })).toBe(false);
  });

  it("rejoins when the reader scrolls back to the live edge", () => {
    expect(shouldFollowLatest({ following: false, distanceFromBottom: 10, scrollDelta: 24 })).toBe(true);
    expect(shouldFollowLatest({ following: false, distanceFromBottom: 90, scrollDelta: 24 })).toBe(false);
  });
});

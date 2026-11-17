import { describe, expect, it } from "vitest";
import { composerPageDirection, composerPlaceholder, shouldFollowLatest, shouldRestComposer } from "./composer-rest";

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

describe("composer placeholder", () => {
  it("names what the composer understands whenever it is idle", () => {
    expect(composerPlaceholder({ running: false })).toBe("Ask anything. @ files, $ skills, / commands");
  });
  it("says what a message does to a running turn, without key glyphs", () => {
    expect(composerPlaceholder({ running: true })).toBe("Queue a follow-up");
    expect(composerPlaceholder({ running: true, steer: true })).toBe("Steer this turn");
  });
});

describe("composer page keys", () => {
  const short = { scrollTop: 0, scrollHeight: 40, clientHeight: 40 };
  const page = (key: string, field = short, extra: { modified?: boolean; composing?: boolean } = {}) =>
    composerPageDirection({ key, field, modified: extra.modified ?? false, composing: extra.composing ?? false });

  it("pages the transcript from a draft that cannot scroll", () => {
    expect(page("PageUp")).toBe(-1);
    expect(page("PageDown")).toBe(1);
    expect(page("ArrowUp")).toBe(0);
  });

  it("leaves the key to a tall draft that can still scroll that way", () => {
    const middle = { scrollTop: 100, scrollHeight: 400, clientHeight: 120 };
    expect(page("PageUp", middle)).toBe(0);
    expect(page("PageDown", middle)).toBe(0);
    expect(page("PageUp", { ...middle, scrollTop: 0 })).toBe(-1);
    expect(page("PageDown", { ...middle, scrollTop: 280 })).toBe(1);
  });

  it("keeps modified keys and IME composition in the field", () => {
    expect(page("PageUp", short, { modified: true })).toBe(0);
    expect(page("PageDown", short, { composing: true })).toBe(0);
  });
});

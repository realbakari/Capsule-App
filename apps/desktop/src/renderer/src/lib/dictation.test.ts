import { describe, expect, it } from "vitest";
import { anchorAt, dictationUnavailableReason, recordingClock, spliceDictation } from "./dictation";

describe("dictation splicing", () => {
  it("inserts at the caret with a space on either side when needed", () => {
    const anchor = anchorAt("Fix thebug", 7, 7);
    expect(spliceDictation(anchor, "login")).toEqual({ draft: "Fix the login bug", caret: 13 });
  });
  it("replaces each refinement instead of appending it", () => {
    const anchor = anchorAt("Say ", 4, 4);
    spliceDictation(anchor, "hello");
    expect(spliceDictation(anchor, "Hello world.").draft).toBe("Say Hello world.");
  });
  it("replaces a selection, and restores it when nothing was said", () => {
    const anchor = anchorAt("keep THIS end", 5, 9);
    expect(spliceDictation(anchor, "that").draft).toBe("keep that end");
    expect(spliceDictation(anchor, "  ").draft).toBe("keep  end");
    expect(anchor.original).toBe("keep THIS end");
  });
  it("does not pad before punctuation or in an empty draft", () => {
    expect(spliceDictation(anchorAt("Hi.", 2, 2), "there").draft).toBe("Hi there.");
    expect(spliceDictation(anchorAt("", 0, 0), "Hello").draft).toBe("Hello");
  });
  it("clamps a stale caret to the draft", () => {
    expect(spliceDictation(anchorAt("ab", 9, 9), "c")).toEqual({ draft: "ab c", caret: 4 });
  });
});

describe("dictation clock", () => {
  it("counts up, then counts down near the cap", () => {
    expect(recordingClock(42_400, 120_000)).toEqual({ label: "0:42", ending: false });
    expect(recordingClock(105_000, 120_000)).toEqual({ label: "Stops in 0:15", ending: true });
    expect(recordingClock(119_100, 120_000)).toEqual({ label: "Stops in 0:01", ending: true });
  });
});

describe("dictation availability", () => {
  it("explains the remote viewer and other systems instead of offering a dead control", () => {
    expect(dictationUnavailableReason({ isDesktop: false, platform: "darwin" })).toMatch(/runs on the Mac/);
    expect(dictationUnavailableReason({ isDesktop: true, platform: "win32" })).toMatch(/unavailable/);
    expect(dictationUnavailableReason({ isDesktop: true, platform: "darwin" })).toBeUndefined();
  });
});

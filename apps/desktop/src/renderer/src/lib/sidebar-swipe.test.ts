import { describe, expect, it } from "vitest";
import { dominantHorizontalDelta, reduceSwipe, swipeTargetAllows } from "./sidebar-swipe.js";

describe("dominantHorizontalDelta", () => {
  it("ignores mostly vertical wheels", () => {
    expect(dominantHorizontalDelta(4, 40)).toBe(0);
    expect(dominantHorizontalDelta(20, 80)).toBe(0);
  });

  it("keeps a clear horizontal swipe", () => {
    expect(dominantHorizontalDelta(30, 8)).toBe(30);
    expect(dominantHorizontalDelta(-40, 10)).toBe(-40);
  });
});

describe("reduceSwipe", () => {
  it("hides after a leftward swipe while the sidebar is open", () => {
    const first = reduceSwipe({ accumulated: 0, deltaX: 40, collapsed: false });
    expect(first.commit).toBeNull();
    expect(reduceSwipe({ accumulated: first.accumulated, deltaX: 40, collapsed: false }).commit).toBe(
      "hide",
    );
  });

  it("shows after a rightward swipe while the sidebar is closed", () => {
    expect(reduceSwipe({ accumulated: 0, deltaX: -80, collapsed: true }).commit).toBe("show");
  });

  it("does not hide from a rightward swipe", () => {
    expect(reduceSwipe({ accumulated: 0, deltaX: -80, collapsed: false }).commit).toBeNull();
  });
});

describe("swipeTargetAllows", () => {
  it("only reveals from the window edge when collapsed", () => {
    expect(swipeTargetAllows({ clientX: 20, target: null }, true)).toBe(true);
    expect(swipeTargetAllows({ clientX: 400, target: null }, true)).toBe(false);
  });

  it("accepts swipes that start in the sidebar", () => {
    const target = { closest: (selector: string) => (selector.includes(".sidebar") ? {} : null) };
    expect(swipeTargetAllows({ clientX: 200, target: target as unknown as EventTarget }, false)).toBe(
      true,
    );
  });
});

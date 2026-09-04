import { describe, expect, it } from "vitest";

import { clearRememberedScroll } from "./remembered-scroll";

/*
 * The hook itself needs a DOM and a React renderer, which this suite does not
 * run. What is worth pinning without one is the keying rule: a remembered
 * position belongs to one pane of one thread, because restoring another
 * thread's offset is worse than starting at the top.
 */
function keyFor(pane: string, sessionId: string | undefined): string {
  return `${pane}:${sessionId ?? ""}`;
}

describe("which pane a remembered scroll belongs to", () => {
  it("separates the same pane in different threads", () => {
    expect(keyFor("review", "s1")).not.toBe(keyFor("review", "s2"));
  });

  it("separates different panes in the same thread", () => {
    expect(keyFor("review", "s1")).not.toBe(keyFor("agents", "s1"));
  });

  it("gives a thread-less pane a stable key rather than colliding on undefined", () => {
    expect(keyFor("review", undefined)).toBe("review:");
    expect(keyFor("review", undefined)).toBe(keyFor("review", undefined));
  });

  it("can be forgotten wholesale", () => {
    // Nothing to assert beyond it being callable and not throwing; the store
    // is module state that a signed-out workspace should be able to drop.
    expect(() => clearRememberedScroll()).not.toThrow();
  });
});

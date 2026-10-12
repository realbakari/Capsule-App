import { describe, expect, it } from "vitest";
import { EMPTY_NAVIGATION, canGoBack, canGoForward, goBack, goForward, pruneNavigation, recordNavigation } from "./navigation-history.js";

const a = { projectId: "p1", sessionId: "s1" };
const b = { projectId: "p1", sessionId: "s2" };
const c = { projectId: "p2", sessionId: "s3" };

describe("navigation history", () => {
  it("records distinct places and ignores a repeat of the current one", () => {
    let history = recordNavigation(EMPTY_NAVIGATION, a);
    history = recordNavigation(history, a);
    history = recordNavigation(history, b);
    expect(history.entries).toEqual([a, b]);
    expect(history.index).toBe(1);
  });

  it("goes back and forward like a browser, and drops forward entries on a new move", () => {
    let history = [a, b, c].reduce(recordNavigation, EMPTY_NAVIGATION);
    expect(canGoBack(history)).toBe(true);
    expect(canGoForward(history)).toBe(false);
    const back = goBack(history)!;
    expect(back.entry).toEqual(b);
    history = back.history;
    expect(canGoForward(history)).toBe(true);
    expect(goForward(history)!.entry).toEqual(c);
    history = recordNavigation(history, a);
    expect(history.entries).toEqual([a, b, a]);
    expect(canGoForward(history)).toBe(false);
  });

  it("ignores an empty selection and refuses to move past either end", () => {
    expect(recordNavigation(EMPTY_NAVIGATION, {})).toBe(EMPTY_NAVIGATION);
    expect(goBack(EMPTY_NAVIGATION)).toBeUndefined();
    expect(goForward(recordNavigation(EMPTY_NAVIGATION, a))).toBeUndefined();
  });

  it("keeps the last fifty places", () => {
    const history = Array.from({ length: 60 }, (_, index) => ({ projectId: "p", sessionId: `s${index}` })).reduce(recordNavigation, EMPTY_NAVIGATION);
    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]?.sessionId).toBe("s10");
    expect(history.index).toBe(49);
  });

  it("forgets a conversation that no longer exists without losing its place", () => {
    const history = goBack([a, b, c].reduce(recordNavigation, EMPTY_NAVIGATION))!.history;
    const pruned = pruneNavigation(history, (entry) => entry.sessionId !== "s2");
    expect(pruned.entries).toEqual([a, c]);
    expect(pruned.index).toBe(0);
    expect(goForward(pruned)!.entry).toEqual(c);
  });
});

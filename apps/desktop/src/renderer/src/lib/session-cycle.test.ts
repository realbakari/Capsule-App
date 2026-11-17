import { describe, expect, it } from "vitest";
import { adjacentSession } from "./session-cycle";

const order = ["pinned", "working", "recent", "other-project"];

describe("adjacent session", () => {
  it("walks the sidebar's order and wraps", () => {
    expect(adjacentSession(order, "working", 1)).toBe("recent");
    expect(adjacentSession(order, "other-project", 1)).toBe("pinned");
    expect(adjacentSession(order, "pinned", -1)).toBe("other-project");
  });

  it("starts at the top going forward and the bottom going back from a hidden thread", () => {
    expect(adjacentSession(order, "snoozed", 1)).toBe("pinned");
    expect(adjacentSession(order, undefined, -1)).toBe("other-project");
    expect(adjacentSession([], "pinned", 1)).toBeUndefined();
  });
});

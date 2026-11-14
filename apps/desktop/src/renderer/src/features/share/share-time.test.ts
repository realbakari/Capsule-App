import { describe, expect, it } from "vitest";
import { shareLinkTiming } from "./share-time";

describe("shareLinkTiming", () => {
  const now = Date.parse("2026-01-02T00:00:00.000Z");
  it("says how old a link is and when it stops working", () => {
    expect(shareLinkTiming({ id: "a", sessionId: "s", createdAt: "2026-01-01T23:59:30.000Z", expiresAt: "2026-01-02T01:00:00.000Z" }, now)).toBe("Created just now · expires in 1h");
    expect(shareLinkTiming({ id: "a", sessionId: "s", createdAt: "2026-01-01T23:55:00.000Z" }, now)).toBe("Created 5m ago · never expires");
    expect(shareLinkTiming({ id: "a", sessionId: "s", createdAt: "2025-12-31T00:00:00.000Z", expiresAt: "2026-01-07T00:00:00.000Z" }, now)).toBe("Created 2d ago · expires in 5d");
  });
});

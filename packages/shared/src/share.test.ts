import { describe, expect, it } from "vitest";

import { aggregatePresence, presenceLabel, presenceSummary, shareGrantActive, viewedSessionId } from "./share.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

describe("presence", () => {
  it("groups live viewers by the thread they are reading, oldest first", () => {
    expect(aggregatePresence([
      { id: "a", access: "paired", label: MAC_CHROME, since: 30, sessionId: "s1" },
      { id: "b", access: "paired", label: IPHONE, since: 10, sessionId: "s1" },
      { id: "c", access: "share", label: MAC_SAFARI, since: 20, sessionId: "s2" },
      { id: "d", access: "paired", label: MAC_SAFARI, since: 5 },
    ])).toEqual([
      { sessionId: "s1", viewers: [{ kind: "phone", label: "iPhone", since: 10 }, { kind: "browser", label: "Chrome on Mac", since: 30 }] },
      { sessionId: "s2", viewers: [{ kind: "share-link", label: "Share link", since: 20 }] },
    ]);
  });

  it("says nothing when nobody else is viewing", () => {
    expect(aggregatePresence([])).toEqual([]);
    expect(presenceSummary([])).toBeUndefined();
    expect(presenceSummary([{ kind: "phone", label: "iPhone", since: 1 }])).toBe("Also open on iPhone");
    expect(presenceSummary([{ kind: "share-link", label: "Share link", since: 1 }])).toBe("Open from a share link");
    expect(presenceSummary([{ kind: "phone", label: "iPhone", since: 1 }, { kind: "browser", label: "Safari on Mac", since: 2 }])).toBe("2 viewers");
  });

  it("names a device the way a person would", () => {
    expect(presenceLabel({ access: "paired", label: MAC_SAFARI })).toBe("Safari on Mac");
    expect(presenceLabel({ access: "paired", label: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" })).toBe("Android phone");
    expect(presenceLabel({ access: "paired", label: MAC_CHROME.slice(0, 60) })).toBe("Browser on Mac");
    expect(presenceLabel({ access: "paired", label: "Paired device" })).toBe("Paired device");
    expect(presenceLabel({ access: "paired", label: "" })).toBe("Browser");
  });

  it("reads the thread a call opens and ignores every other call", () => {
    expect(viewedSessionId("listMessagePage", ["s1", { limit: 50 }])).toBe("s1");
    expect(viewedSessionId("listRunPage", [{ sessionId: "s2" }])).toBe("s2");
    expect(viewedSessionId("listRunPage", [{}])).toBeUndefined();
    expect(viewedSessionId("listProjects", [])).toBeUndefined();
    expect(viewedSessionId("listMessages", [42])).toBeUndefined();
  });
});

describe("share grants", () => {
  it("is active until revoked or expired", () => {
    const grant = { id: "g", sessionId: "s", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(shareGrantActive(grant)).toBe(true);
    expect(shareGrantActive({ ...grant, revokedAt: "2026-01-02T00:00:00.000Z" })).toBe(false);
    expect(shareGrantActive({ ...grant, expiresAt: "2026-01-02T00:00:00.000Z" }, Date.parse("2026-01-01T12:00:00.000Z"))).toBe(true);
    expect(shareGrantActive({ ...grant, expiresAt: "2026-01-02T00:00:00.000Z" }, Date.parse("2026-01-02T00:00:00.000Z"))).toBe(false);
  });
});

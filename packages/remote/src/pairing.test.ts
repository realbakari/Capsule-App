import { describe, expect, it } from "vitest";

import {
  exchangeGrant,
  GRANT_TTL_MS,
  hashToken,
  issueGrant,
  pruneExpired,
  resolveSession,
  SESSION_TTL_MS,
  tokenMatches,
} from "./pairing.js";

const now = Date.parse("2026-09-02T12:00:00.000Z");

describe("pairing grants", () => {
  it("keeps only the hash of a token", () => {
    const { grant, token } = issueGrant({ scopes: ["read"], now });
    expect(JSON.stringify(grant)).not.toContain(token);
    expect(grant.tokenHash).toBe(hashToken(token));
  });

  it("is spent by the first exchange", () => {
    const { grant, token } = issueGrant({ scopes: ["read"], now });
    const first = exchangeGrant({ grants: [grant], token, label: "Phone", now });
    expect("session" in first).toBe(true);
    const second = exchangeGrant({ grants: [grant], token, label: "Phone again", now });
    expect(second).toEqual({ error: "consumed" });
  });

  it("expires", () => {
    const { grant, token } = issueGrant({ scopes: ["read"], now });
    const late = exchangeGrant({
      grants: [grant],
      token,
      label: "Phone",
      now: now + GRANT_TTL_MS + 1,
    });
    expect(late).toEqual({ error: "expired" });
  });

  it("does not recognise a token it never issued", () => {
    const { grant } = issueGrant({ scopes: ["read"], now });
    expect(exchangeGrant({ grants: [grant], token: "not-a-token", label: "x", now })).toEqual({
      error: "unknown",
    });
  });

  it("hands the session exactly the grant's scopes", () => {
    const { grant, token } = issueGrant({ scopes: ["read"], now });
    const result = exchangeGrant({ grants: [grant], token, label: "Phone", now });
    expect("session" in result && result.session.scopes).toEqual(["read"]);
  });
});

describe("remote sessions", () => {
  function paired() {
    const { grant, token } = issueGrant({ scopes: ["read"], now });
    const result = exchangeGrant({ grants: [grant], token, label: "Phone", now });
    if (!("session" in result)) throw new Error("expected a session");
    return result;
  }

  it("resolves its own bearer token and nothing else", () => {
    const { session, token } = paired();
    expect(resolveSession([session], token, now)?.id).toBe(session.id);
    expect(resolveSession([session], "someone-elses-token", now)).toBeUndefined();
  });

  it("stops resolving once it expires", () => {
    const { session, token } = paired();
    expect(resolveSession([session], token, now + SESSION_TTL_MS + 1)).toBeUndefined();
  });

  it("records when it was last used", () => {
    const { session, token } = paired();
    resolveSession([session], token, now + 5_000);
    expect(session.lastSeenAt).toBe(now + 5_000);
  });
});

describe("token comparison", () => {
  it("matches a token against its hash", () => {
    expect(tokenMatches("abc", hashToken("abc"))).toBe(true);
    expect(tokenMatches("abd", hashToken("abc"))).toBe(false);
    // A malformed hash must be false, not a crash.
    expect(tokenMatches("abc", "not-hex")).toBe(false);
  });
});

describe("pruneExpired", () => {
  it("keeps what is still valid", () => {
    const items = [{ expiresAt: now - 1 }, { expiresAt: now + 1 }];
    expect(pruneExpired(items, now)).toEqual([{ expiresAt: now + 1 }]);
  });
});

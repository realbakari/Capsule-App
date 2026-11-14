import { describe, expect, it } from "vitest";
import { pullRequestBadge, samePullRequest, toThreadPullRequest, type ThreadPullRequest } from "./thread-pull-request.js";

const base: ThreadPullRequest = { number: 7, url: "https://example.test/repo/pull/7", state: "OPEN", isDraft: false, seenAt: "2026-01-01T00:00:00.000Z" };

describe("pullRequestBadge", () => {
  it("names one state per pull request, most urgent first", () => {
    expect(pullRequestBadge(undefined)).toBeUndefined();
    expect(pullRequestBadge(base)?.kind).toBe("open");
    expect(pullRequestBadge({ ...base, isDraft: true })?.kind).toBe("draft");
    expect(pullRequestBadge({ ...base, checks: "failure" })?.kind).toBe("failing");
    expect(pullRequestBadge({ ...base, isDraft: true, checks: "failure" })?.kind).toBe("failing");
    expect(pullRequestBadge({ ...base, state: "MERGED", checks: "failure" })?.kind).toBe("merged");
    expect(pullRequestBadge({ ...base, state: "closed" })?.kind).toBe("closed");
    expect(pullRequestBadge({ ...base, checks: "pending" })?.kind).toBe("open");
  });

  it("says the number and state in words", () => {
    expect(pullRequestBadge({ ...base, checks: "failure" })?.title).toBe("Pull request #7 · Checks failing");
  });
});

describe("samePullRequest", () => {
  it("ignores when it was read, not what was read", () => {
    const reading = toThreadPullRequest({ number: 7, url: base.url, title: "x", isDraft: false, state: "OPEN" }, "2026-02-02T00:00:00.000Z");
    expect(samePullRequest(base, reading)).toBe(true);
    expect(samePullRequest(base, { ...reading, checks: "failure" })).toBe(false);
    expect(samePullRequest(undefined, undefined)).toBe(true);
    expect(samePullRequest(base, undefined)).toBe(false);
  });
});

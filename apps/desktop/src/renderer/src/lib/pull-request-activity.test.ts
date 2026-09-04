import { describe, expect, it } from "vitest";
import type { GitPullRequestDetail } from "@capsule/shared";
import { activityTime, pullRequestTimeline, reviewStateLabel } from "./pull-request-activity";

const detail: GitPullRequestDetail = {
  number: 42, url: "https://github.com/example/repo/pull/42", title: "Add feature", isDraft: false, state: "MERGED", body: "",
  createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-03T12:00:00Z", mergedAt: "2026-09-02T10:00:00Z", closedAt: "2026-09-02T10:00:00Z",
  additions: 1, deletions: 0, changedFiles: 1, reviewers: [], labels: [], checkRuns: [], files: [], diff: "",
  commits: [{ oid: "a".repeat(40), title: "Address feedback", authors: ["dev"], authoredAt: "2026-09-01T12:00:00Z" }],
  activity: [
    { id: "1", kind: "comment", author: "one", body: "First", createdAt: "2026-09-01T10:30:00Z" },
    { id: "2", kind: "review", author: "two", body: "Second", createdAt: "2026-09-01T11:00:00Z" },
    { id: "3", kind: "comment", author: "one", body: "Third", createdAt: "2026-09-01T13:00:00Z" },
  ],
};

describe("pull request timeline", () => {
  it("groups adjacent conversations without swallowing a commit", () => {
    const groups = pullRequestTimeline(detail, false);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["opened-42"], ["comment-1", "review-2"], [`commit-${"a".repeat(40)}`], ["comment-3"], ["merged-42"],
    ]);
    expect(groups.at(-1)?.items[0]?.at).toBe(detail.mergedAt);
  });
  it("reverses both group order and the comments within each group without mutating data", () => {
    const before = JSON.stringify(detail);
    expect(pullRequestTimeline(detail, true).flatMap((group) => group.items.map((item) => item.id))).toEqual(
      pullRequestTimeline(detail, false).flatMap((group) => group.items.map((item) => item.id)).reverse(),
    );
    expect(JSON.stringify(detail)).toBe(before);
  });
  it("shows a close instead of a merge and does not fabricate missing event times", () => {
    expect(pullRequestTimeline({ ...detail, mergedAt: undefined }, true)[0]?.items[0]?.kind).toBe("closed");
    expect(pullRequestTimeline({ ...detail, mergedAt: undefined, closedAt: undefined }, true).flatMap((g) => g.items).some((item) => item.kind === "closed" || item.kind === "merged")).toBe(false);
  });
  it("handles missing timestamps and formats review states for people", () => {
    expect(activityTime("bad date")).toBe(0);
    expect(reviewStateLabel("CHANGES_REQUESTED")).toBe("Changes requested");
    expect(reviewStateLabel()).toBe("Review");
  });
});

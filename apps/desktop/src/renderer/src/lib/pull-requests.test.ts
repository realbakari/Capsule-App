import { describe, expect, it } from "vitest";
import type { GitPullRequest } from "@capsule/shared";
import { visiblePullRequests } from "./pull-requests";

const items: GitPullRequest[] = [
  { number: 1, title: "Fix login", url: "https://github.com/example/repo/pull/1", state: "OPEN", isDraft: false, author: "Alex", headRefName: "fix/login", updatedAt: "2026-01-03", createdAt: "2026-01-01" },
  { number: 2, title: "Add tests", url: "https://github.com/example/repo/pull/2", state: "OPEN", isDraft: true, author: "Sam", headRefName: "test/auth", updatedAt: "2026-01-02", createdAt: "2026-01-02" },
];

describe("pull request list controls", () => {
  it.each(["fix login", "ALEX", "fix/login", "#1"])("filters loaded results by %s", (query) => {
    expect(visiblePullRequests(items, query, "updated").map((item) => item.number)).toEqual([1]);
  });
  it("sorts without changing the cached order", () => {
    expect(visiblePullRequests(items, "", "created").map((item) => item.number)).toEqual([2, 1]);
    expect(visiblePullRequests(items, "", "updated").map((item) => item.number)).toEqual([1, 2]);
    expect(items[0]?.number).toBe(1);
  });
  it("shows all items again after clearing the filter", () => {
    expect(visiblePullRequests(items, "missing", "updated")).toEqual([]);
    expect(visiblePullRequests(items, "  ", "updated")).toHaveLength(2);
  });
});

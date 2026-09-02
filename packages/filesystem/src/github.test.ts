import { describe, expect, it } from "vitest";
import {
  createPullRequestArgs,
  mergePullRequestArgs,
  parsePullRequestDetail,
  parsePullRequestList,
  pushArgs,
} from "./github.js";

describe("git and pull request args", () => {
  it("pushes with lease only when asked", () => {
    expect(pushArgs(false)).toEqual(["push", "-u", "origin", "HEAD"]);
    expect(pushArgs(true)).toEqual(["push", "--force-with-lease", "-u", "origin", "HEAD"]);
  });

  it("creates a draft pull request", () => {
    expect(
      createPullRequestArgs({ title: "Fix login", body: "Use draft.", draft: true }),
    ).toEqual(["pr", "create", "--title", "Fix login", "--body", "Use draft.", "--draft"]);
  });

  it("merges with the chosen method and optional auto", () => {
    expect(mergePullRequestArgs("squash", false)).toEqual(["pr", "merge", "--squash"]);
    expect(mergePullRequestArgs("rebase", true)).toEqual(["pr", "merge", "--rebase", "--auto"]);
    expect(mergePullRequestArgs("merge", true)).toEqual(["pr", "merge", "--merge", "--auto"]);
  });

  it("normalizes pull request list rows", () => {
    expect(
      parsePullRequestList(
        JSON.stringify([
          {
            number: 42,
            url: "https://github.com/example/repo/pull/42",
            title: "Ship it",
            state: "OPEN",
            author: { login: "octocat" },
            headRefName: "feature/ship",
            statusCheckRollup: [{ state: "SUCCESS" }],
          },
        ]),
      )[0],
    ).toMatchObject({ number: 42, title: "Ship it", author: "octocat", checks: "success" });
  });

  it("normalizes pull request detail, activity, commits, and files", () => {
    const detail = parsePullRequestDetail(
      JSON.stringify({
        number: 42,
        url: "https://github.com/example/repo/pull/42",
        title: "Ship it",
        body: "## Why\n\nReady.",
        state: "OPEN",
        author: { login: "octocat" },
        headRefName: "feature/ship",
        baseRefName: "main",
        additions: 12,
        deletions: 3,
        changedFiles: 1,
        labels: [{ name: "ready" }],
        reviewRequests: [{ login: "reviewer" }],
        comments: [{ id: "c1", author: { login: "sam" }, body: "Nice", createdAt: "2026-01-01" }],
        reviews: [{ id: "r1", author: { login: "lee" }, body: "LGTM", state: "APPROVED", submittedAt: "2026-01-02" }],
        commits: [{ oid: "abcdef", messageHeadline: "Ship", authoredDate: "2026-01-01", authors: [{ login: "octocat" }] }],
        files: [{ path: "src/app.ts", additions: 12, deletions: 3 }],
        statusCheckRollup: [{ state: "SUCCESS" }],
      }),
      "diff --git a/src/app.ts b/src/app.ts",
    );

    expect(detail).toMatchObject({
      number: 42,
      author: "octocat",
      baseRefName: "main",
      headRefName: "feature/ship",
      checks: "success",
      labels: ["ready"],
      reviewers: ["reviewer"],
      files: [{ path: "src/app.ts", additions: 12, deletions: 3 }],
    });
    expect(detail?.activity.map((item) => item.kind)).toEqual(["comment", "review"]);
    expect(detail?.commits[0]).toMatchObject({ oid: "abcdef", title: "Ship", authors: ["octocat"] });
    expect(detail?.diff).toContain("src/app.ts");
  });
});

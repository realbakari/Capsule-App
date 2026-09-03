import { describe, expect, it } from "vitest";
import {
  createPullRequestArgs,
  diffFailureReason,
  mergePullRequestArgs,
  parseChecks,
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

describe("the checks behind the rollup", () => {
  it("names each run instead of reducing them all to one word", () => {
    const checks = parseChecks([
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "StatusContext", context: "ci/legacy", state: "PENDING" },
    ]);
    expect(checks.map((check) => [check.name, check.state])).toEqual([
      ["build", "success"],
      ["ci/legacy", "pending"],
      ["test", "failure"],
    ]);
  });

  it("keeps only the newest run of a check that ran twice", () => {
    /*
     * A branch pushed twice reports the same check once per push. Counting
     * both makes "17 of 27 passing" a number matching nothing anyone can see,
     * and an old failure would outlive the push that fixed it.
     */
    const checks = parseChecks([
      {
        name: "build",
        workflowName: "CI",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: "2026-09-01T10:00:00Z",
      },
      {
        name: "build",
        workflowName: "CI",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-09-02T10:00:00Z",
      },
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.state).toBe("success");
  });

  it("calls a run that has not finished pending, not neutral", () => {
    const [check] = parseChecks([{ name: "build", status: "IN_PROGRESS" }]);
    expect(check?.state).toBe("pending");
  });

  it("carries the link to the run so a failure can be opened", () => {
    const [check] = parseChecks([
      { name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://x/1" },
    ]);
    expect(check?.url).toBe("https://x/1");
  });

  it("ignores entries with no name rather than listing a blank row", () => {
    expect(parseChecks([{ status: "COMPLETED" }, null, "nope"])).toEqual([]);
  });
});

describe("a pull request whose diff GitHub will not render", () => {
  it("says the pull request is too large rather than that nothing came back", () => {
    // The Code tab used to show "No patch was returned", which reads as a bug
    // in Capsule rather than a ceiling at GitHub that no retry will move.
    const reason = diffFailureReason(
      "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300).",
    );
    expect(reason).toMatch(/too large|this large/i);
  });

  it("falls back to whatever gh actually said", () => {
    expect(diffFailureReason("fatal: not a git repository")).toBe("fatal: not a git repository");
  });

  it("has something to say even when gh said nothing", () => {
    expect(diffFailureReason("")).toMatch(/no diff/i);
  });
});

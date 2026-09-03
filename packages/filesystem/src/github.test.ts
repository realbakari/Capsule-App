import { describe, expect, it } from "vitest";
import {
  createPullRequestArgs,
  diffFailureReason,
  listFailureReason,
  mergePullRequestArgs,
  parseChecks,
  parseLabels,
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
      labels: [{ name: "ready" }],
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

describe("why there are no pull requests to show", () => {
  it("does not blame the sign-in for a folder with no GitHub remote", () => {
    /*
     * The pane guessed "check that `gh` is signed in" for every failure. This
     * is the common one, it is not a sign-in problem, and refreshing will
     * never fix it.
     */
    expect(listFailureReason("no git remotes found")).toMatch(/no GitHub remote/i);
    expect(listFailureReason("no git remotes found")).not.toMatch(/signed in/i);
  });

  it("says to sign in when that is actually the problem", () => {
    expect(listFailureReason("gh: To use GitHub CLI, run: gh auth login")).toMatch(/gh auth login/);
  });

  it("tells rate limiting apart from being offline", () => {
    expect(listFailureReason("HTTP 403: API rate limit exceeded")).toMatch(/rate limiting/i);
    expect(listFailureReason("dial tcp: lookup api.github.com: no such host")).toMatch(
      /connection/i,
    );
  });

  it("says gh is missing rather than that GitHub is unreachable", () => {
    expect(listFailureReason("exec: \"gh\": executable file not found in $PATH")).toMatch(
      /not installed/i,
    );
  });

  it("passes an unknown failure through rather than inventing a cause", () => {
    expect(listFailureReason("something odd happened")).toBe("something odd happened");
  });

  it("still says something when gh said nothing", () => {
    expect(listFailureReason("")).toMatch(/could not be listed/i);
  });
});

describe("when the trouble is GitHub's own", () => {
  it("does not hand the user GitHub's apology paragraph", () => {
    /*
     * The real thing gh returns: three sentences, an apology, and a link to
     * the GraphQL endpoint. Nothing in it is actionable except waiting.
     */
    const reason = listFailureReason(
      "HTTP 504: We couldn't respond to your request in time. Sorry about that. Please try resubmitting your request and contact us if the problem persists. (https://api.github.com/graphql)",
    );
    expect(reason).toBe("GitHub is having trouble right now. Try again in a moment.");
  });

  it("treats a bad gateway the same way", () => {
    expect(listFailureReason("HTTP 502: Bad gateway")).toMatch(/trouble right now/i);
  });

  it("still tells a rate limit apart from an outage", () => {
    expect(listFailureReason("HTTP 403: API rate limit exceeded")).toMatch(/rate limiting/i);
  });
});

describe("labels", () => {
  it("keeps the colour the repository chose", () => {
    /*
     * The colour is the label's point — green for a vouched author, orange
     * for a large change — and only the name was kept, so every label
     * rendered the same grey.
     */
    const labels = parseLabels([
      { name: "vouch:trusted", color: "1f883d", description: "PR author is trusted." },
      { name: "size:L", color: "fe7d37" },
    ]);
    expect(labels).toEqual([
      { name: "vouch:trusted", color: "1f883d", description: "PR author is trusted." },
      { name: "size:L", color: "fe7d37" },
    ]);
  });

  it("takes a colour only when it is one", () => {
    // Anything else would go straight into a style attribute.
    expect(parseLabels([{ name: "a", color: "red" }])[0]?.color).toBeUndefined();
    expect(parseLabels([{ name: "b", color: "#1F883D" }])[0]?.color).toBe("1f883d");
    expect(parseLabels([{ name: "c", color: "12345" }])[0]?.color).toBeUndefined();
  });

  it("still reads the plain strings older callers pass", () => {
    expect(parseLabels(["bug", "chore"])).toEqual([{ name: "bug" }, { name: "chore" }]);
  });

  it("skips entries with no name rather than rendering a blank pill", () => {
    expect(parseLabels([{ color: "1f883d" }, null, 7, ""])).toEqual([]);
  });
});

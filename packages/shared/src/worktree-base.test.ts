import { describe, expect, it } from "vitest";
import { parseGitRefName, parseStartPullRequestInput, pullRequestDraft } from "./worktree-base.js";

describe("parseGitRefName", () => {
  it("accepts branch names people pick", () => {
    for (const name of ["main", "HEAD", "origin/main", "feature/login-v2", "release-1.2", "refs/capsule/pull/12", "user@fix"]) {
      expect(parseGitRefName(name)).toBe(name);
    }
  });

  it("rejects options, revision syntax and names Git refuses", () => {
    for (const name of [
      "", " ", "-main", "--upload-pack=touch /tmp/x", "main..dev", "main~1", "main^", "HEAD@{1}", "a:b", "a b",
      "a\nb", "a\u0000b", "feat*", "what?", "[x]", "back\\slash", "/main", "main/", "main.", "a//b", ".hidden",
      "x/.y", "main.lock", "x/y.lock/z", "@", "a".repeat(201),
    ]) {
      expect(parseGitRefName(name), JSON.stringify(name)).toBeUndefined();
    }
    expect(parseGitRefName(42)).toBeUndefined();
    expect(parseGitRefName(undefined)).toBeUndefined();
  });
});

describe("parseStartPullRequestInput", () => {
  const valid = { projectId: "p1", number: 7, title: "Fix login", url: "https://github.com/acme/app/pull/7", headRefName: "fix-login", target: "worktree" };

  it("keeps a well-formed request", () => {
    expect(parseStartPullRequestInput(valid)).toEqual(valid);
    const { headRefName: _omitted, ...withoutHead } = valid;
    expect(parseStartPullRequestInput(withoutHead)).toEqual(withoutHead);
  });

  it("rejects a bad number, target, URL or head branch", () => {
    expect(parseStartPullRequestInput({ ...valid, number: 0 })).toBeUndefined();
    expect(parseStartPullRequestInput({ ...valid, number: 1.5 })).toBeUndefined();
    expect(parseStartPullRequestInput({ ...valid, target: "elsewhere" })).toBeUndefined();
    expect(parseStartPullRequestInput({ ...valid, url: "javascript:alert(1)" })).toBeUndefined();
    expect(parseStartPullRequestInput({ ...valid, headRefName: "--force" })).toBeUndefined();
    expect(parseStartPullRequestInput(null)).toBeUndefined();
  });
});

it("drafts a prompt that names the pull request", () => {
  expect(pullRequestDraft({ number: 7, title: "  Fix\nlogin ", url: "https://github.com/acme/app/pull/7" }))
    .toBe("Working on pull request #7: Fix login\nhttps://github.com/acme/app/pull/7\n\n");
});

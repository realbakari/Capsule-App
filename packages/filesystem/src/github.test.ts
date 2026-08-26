import { describe, expect, it } from "vitest";
import { createPullRequestArgs, mergePullRequestArgs, pushArgs } from "./github.js";

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
});

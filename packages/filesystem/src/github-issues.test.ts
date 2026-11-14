import { describe, expect, it } from "vitest";
import { listFailureReason, parseIssueList } from "./github.js";

describe("issue listing", () => {
  it("reads gh's issue list and skips rows it cannot use", () => {
    const raw = JSON.stringify([
      { number: 4, title: "Fix login", body: "It fails", url: "https://example.test/o/r/issues/4", labels: [{ name: "bug", color: "d73a4a" }], author: { login: "octo" }, updatedAt: "2026-01-02T00:00:00Z" },
      { number: 5, title: "No body", body: null, url: "https://example.test/o/r/issues/5", labels: [] },
      { title: "No number" },
    ]);
    expect(parseIssueList(raw)).toEqual([
      { number: 4, title: "Fix login", body: "It fails", url: "https://example.test/o/r/issues/4", labels: ["bug"], author: "octo", updatedAt: "2026-01-02T00:00:00Z" },
      { number: 5, title: "No body", body: "", url: "https://example.test/o/r/issues/5", labels: [] },
    ]);
    expect(parseIssueList("not json")).toBeUndefined();
  });

  it("explains a missing or signed-out gh in terms of issues", () => {
    expect(listFailureReason("exec: \"gh\": executable file not found in $PATH", "issues")).toBe("The `gh` command is not installed, so issues cannot be listed.");
    expect(listFailureReason("To get started with GitHub CLI, please run:  gh auth login", "issues")).toContain("gh auth login");
    expect(listFailureReason("no git remotes found", "issues")).toBe("This folder has no GitHub remote, so there are no issues to show.");
    expect(listFailureReason("", "issues")).toBe("Issues could not be listed.");
    expect(listFailureReason("no git remotes found")).toContain("pull requests");
  });
});

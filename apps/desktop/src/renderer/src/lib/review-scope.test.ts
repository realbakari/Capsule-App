import { describe, expect, it } from "vitest";
import type { Run } from "@capsule/shared";
import {
  changeStatus,
  ignoreWhitespaceFor,
  parseScopeValue,
  promptExcerpt,
  rememberIgnoreWhitespace,
  rememberScope,
  rememberedScope,
  reviewTurns,
  scopeValue,
} from "./review-scope";

const run = (id: string, createdAt: string, prompt: string, checkpointRef?: string): Run =>
  ({ id, createdAt, updatedAt: createdAt, prompt, checkpointRef, sessionId: "s", projectId: "p", agentId: "a", status: "completed" }) as Run;

describe("review turns", () => {
  it("numbers every turn from the first and lists checkpointed ones newest first", () => {
    const turns = reviewTurns([
      run("c", "2026-01-03", "third", "refs/x/c"),
      run("a", "2026-01-01", "first  prompt\nwith lines", "refs/x/a"),
      run("b", "2026-01-02", "second, no checkpoint"),
    ]);
    expect(turns.map((turn) => turn.label)).toEqual(["Turn 3 · third", "Turn 1 · first prompt with lines"]);
  });

  it("shortens long prompts and names empty ones", () => {
    expect(promptExcerpt("x".repeat(80))).toHaveLength(48);
    expect(promptExcerpt("   ")).toBe("Untitled turn");
  });

  it("round-trips a scope through the select value", () => {
    expect(parseScopeValue(scopeValue({ kind: "turn", runId: "r1" }))).toEqual({ kind: "turn", runId: "r1" });
    expect(parseScopeValue("uncommitted")).toEqual({ kind: "uncommitted" });
    expect(parseScopeValue("turn:")).toEqual({ kind: "uncommitted" });
  });

  it("remembers the scope and whitespace choice per thread", () => {
    rememberScope("t1", { kind: "turn", runId: "r1" });
    expect(rememberedScope("t1")).toEqual({ kind: "turn", runId: "r1" });
    expect(rememberedScope("t2")).toEqual({ kind: "uncommitted" });
    rememberScope("t1", { kind: "uncommitted" });
    expect(rememberedScope("t1")).toEqual({ kind: "uncommitted" });
    rememberIgnoreWhitespace("t1", true, false);
    expect(ignoreWhitespaceFor("t1", false)).toBe(true);
    expect(ignoreWhitespaceFor("t2", false)).toBe(false);
    // Matching the setting again drops the override, so a later setting change applies.
    rememberIgnoreWhitespace("t1", false, false);
    expect(ignoreWhitespaceFor("t1", true)).toBe(true);
  });
});

describe("changeStatus", () => {
  it("names a porcelain code in words a reader can act on", () => {
    expect(changeStatus("??")).toEqual({ letter: "U", title: "Untracked: new and not added to Git yet" });
    expect(changeStatus(" M")).toEqual({ letter: "M", title: "Modified, not staged" });
    expect(changeStatus("M ")).toEqual({ letter: "M", title: "Modified, staged" });
    expect(changeStatus("MM")).toEqual({ letter: "M", title: "Modified, partly staged" });
    expect(changeStatus("A ").title).toBe("Added, staged");
    expect(changeStatus("UU").letter).toBe("!");
    expect(changeStatus("R ").title).toBe("Renamed, staged");
  });
});

describe("review targets", () => {
  it("round-trips a commit pick and keeps it only while the commit is listed", async () => {
    const { chooseReview, reviewSelection, selectionValue, reviewScope } = await import("./review-scope");
    const commits = [{ oid: "b".repeat(40), subject: "newest", author: "a", date: "2026-01-02" }, { oid: "a".repeat(40), subject: "older", author: "a", date: "2026-01-01" }];
    chooseReview("p-commit", "t-commit", `commit:${"a".repeat(40)}`);
    expect(reviewScope("p-commit")).toBe("commit");
    const picked = reviewSelection("commit", "t-commit", [], false, "p-commit", { commits, loading: false });
    expect(picked).toEqual({ kind: "commit", oid: "a".repeat(40) });
    expect(selectionValue(picked)).toBe(`commit:${"a".repeat(40)}`);
    expect(reviewSelection("commit", "t-commit", [], false, "p-commit", { commits: commits.slice(0, 1), loading: false })).toEqual({ kind: "commit", oid: "b".repeat(40) });
    expect(reviewSelection("commit", "t-commit", [], false, "p-commit", { commits: [], loading: true })).toEqual({ kind: "commit", oid: "a".repeat(40) });
  });

  it("remembers the Branch base per project and forgets it when cleared", async () => {
    const { reviewSelection, setReviewBase } = await import("./review-scope");
    setReviewBase("p-base", "origin/release");
    expect(reviewSelection("branch", "t", [], false, "p-base")).toEqual({ kind: "branch", base: "origin/release" });
    expect(reviewSelection("branch", "t", [], false, "other")).toEqual({ kind: "branch", base: undefined });
    setReviewBase("p-base", undefined);
    expect(reviewSelection("branch", "t", [], false, "p-base")).toEqual({ kind: "branch", base: undefined });
  });

  it("tells test files from source by common conventions", async () => {
    const { isTestPath } = await import("./review-scope");
    for (const path of ["src/a.test.ts", "src/a.spec.tsx", "pkg/__tests__/x.ts", "tests/test_db.py", "db_test.go", "spec/models/user_spec.rb", "App/LoginTests.swift", "e2e/flow.ts"]) expect(isTestPath(path), path).toBe(true);
    for (const path of ["src/testing-library.ts", "src/contest.ts", "src/latest.ts", "docs/testing.md", "src/attest.ts"]) expect(isTestPath(path), path).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { GitStatus } from "@capsule/shared";
import { commitPlan, onDefaultBranch, pushBlocked, suggestBranch, syncState } from "./git-plan";

const status = (patch: Partial<GitStatus>): GitStatus => ({
  available: true, isRepo: true, branch: "feature", dirty: false, changed: 0, summary: "", files: [], branches: ["feature"], ...patch,
});

describe("sync state", () => {
  it.each([
    [{ branch: "HEAD" }, "detached"],
    [{}, "no-remote"],
    [{ pushRemote: "fork" }, "publish"],
    [{ upstream: "origin/feature", ahead: 0, behind: 0 }, "synced"],
    [{ upstream: "origin/feature", ahead: 2, behind: 0 }, "ahead"],
    [{ upstream: "origin/feature", ahead: 0, behind: 3 }, "behind"],
    [{ upstream: "origin/feature", ahead: 1, behind: 1 }, "diverged"],
  ] as const)("%j is %s", (patch, kind) => {
    expect(syncState(status(patch)).kind).toBe(kind);
  });

  it("holds Push back while behind, with the reason, and lets a never-pushed branch publish", () => {
    expect(pushBlocked(syncState(status({ upstream: "origin/feature", behind: 2 })))).toBe("Pull first: origin/feature has 2 commits this branch lacks.");
    expect(pushBlocked(syncState(status({ pushRemote: "origin" })))).toBeUndefined();
    expect(pushBlocked(syncState(status({ upstream: "origin/feature", ahead: 1 })))).toBeUndefined();
  });

  it("knows the default branch only by name", () => {
    expect(onDefaultBranch(status({ branch: "main", defaultBranch: "main" }))).toBe(true);
    expect(onDefaultBranch(status({ branch: "feature", defaultBranch: "main" }))).toBe(false);
    expect(onDefaultBranch(status({ branch: "main" }))).toBe(false);
  });
});

describe("commit plan", () => {
  it("takes the index when anything is staged, and the checklist otherwise", () => {
    expect(commitPlan([])).toEqual({ kind: "clean" });
    expect(commitPlan([{ path: "a", code: "M " }, { path: "b", code: " M" }, { path: "c", code: "MM" }])).toEqual({ kind: "staged", count: 2 });
    expect(commitPlan([{ path: "b", code: " M" }, { path: "n", code: "??" }])).toEqual({
      kind: "choose", tracked: [{ path: "b", code: " M" }], untracked: [{ path: "n", code: "??" }],
    });
  });
});

it("suggests a prefixed branch from the subject that does not collide", () => {
  expect(suggestBranch("capsule", "Fix the login cookie!\n\nBody", [])).toBe("capsule/fix-the-login-cookie");
  expect(suggestBranch(undefined, "", [])).toBe("changes");
  expect(suggestBranch("capsule", "Fix", ["capsule/fix", "capsule/fix-2"])).toBe("capsule/fix-3");
});

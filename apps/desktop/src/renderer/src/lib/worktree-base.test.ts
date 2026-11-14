import { describe, expect, it } from "vitest";
import type { WorktreeBases } from "@capsule/shared";
import { defaultBaseDetail, filterMenuOptions, worktreeBaseOptions } from "./worktree-base";

const bases: WorktreeBases = {
  defaultRef: "origin/main",
  remote: "origin",
  currentBranch: "feature",
  choices: [
    { ref: "feature", kind: "local" },
    { ref: "origin/release", kind: "remote" },
    { ref: "origin/main", kind: "remote" },
    { ref: "main", kind: "local" },
  ],
};

describe("worktree base options", () => {
  it("puts the default first, then remote and local branches without repeats", () => {
    expect(worktreeBaseOptions(bases).map((row) => [row.group, row.id])).toEqual([
      ["Default", "origin/main"],
      ["Remote branches", "origin/release"],
      ["Local branches", "feature"],
      ["Local branches", "main"],
    ]);
  });

  it("keeps a chosen ref that is not in the recent list", () => {
    expect(worktreeBaseOptions(bases, "old-branch")[1]).toEqual({ id: "old-branch", label: "old-branch", group: "Chosen" });
  });

  it("offers follow-the-default as an empty id for a project setting", () => {
    expect(worktreeBaseOptions(bases, undefined, true)[0]).toEqual({ id: "", label: "Default (origin/main)", group: "Default" });
    expect(worktreeBaseOptions(bases, undefined, true).some((row) => row.id === "origin/main")).toBe(true);
  });

  it("says what happens without a remote", () => {
    expect(defaultBaseDetail({ defaultRef: "HEAD", currentBranch: "main", choices: [] })).toMatch(/No remote.*current commit on main/);
    expect(defaultBaseDetail(bases)).toContain("origin/main");
  });

  it("filters on label, detail and group", () => {
    const rows = worktreeBaseOptions(bases);
    expect(filterMenuOptions(rows, "REL").map((row) => row.id)).toEqual(["origin/release"]);
    expect(filterMenuOptions(rows, "local").map((row) => row.id)).toEqual(["feature", "main"]);
    expect(filterMenuOptions(rows, "  ")).toBe(rows);
  });
});

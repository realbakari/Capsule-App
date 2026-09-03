import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { clearFileIndex, projectFiles, rankFiles, readProjectFiles, scorePath } from "./file-index.js";

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-index-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(path.join(dir, "src/features/threads/git"), { recursive: true });
  mkdirSync(path.join(dir, "node_modules/left-pad"), { recursive: true });
  mkdirSync(path.join(dir, "build"), { recursive: true });
  writeFileSync(path.join(dir, ".gitignore"), "build/\nnode_modules/\n");
  writeFileSync(path.join(dir, "README.md"), "hi\n");
  writeFileSync(path.join(dir, "src/index.ts"), "x\n");
  writeFileSync(path.join(dir, "src/features/threads/git/GitCommitSheet.tsx"), "x\n");
  writeFileSync(path.join(dir, "node_modules/left-pad/index.js"), "x\n");
  writeFileSync(path.join(dir, "build/index.js"), "x\n");
  return dir;
}

describe("what a project's files are", () => {
  it("honours the project's own ignore rules rather than a list in our source", () => {
    // The old walk skipped a hardcoded set of directory names. A project that
    // ignores something else — target, .venv, a vendored checkout — got it
    // indexed anyway, and one that tracks a "build" directory lost it.
    const files = readProjectFiles(repo());
    expect(files).toContain("README.md");
    expect(files).toContain("src/features/threads/git/GitCommitSheet.tsx");
    expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(files.some((file) => file.startsWith("build/"))).toBe(false);
  });

  it("finds a file deeper than the old walk would reach", () => {
    const files = readProjectFiles(repo());
    expect(files).toContain("src/features/threads/git/GitCommitSheet.tsx");
  });

  it("still lists a folder that is not a repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-plain-"));
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "notes.md"), "x\n");
    writeFileSync(path.join(dir, "node_modules/pkg.js"), "x\n");
    expect(readProjectFiles(dir)).toEqual(["notes.md"]);
  });

  it("reads the tree once and answers from memory after that", () => {
    const dir = repo();
    clearFileIndex();
    const first = projectFiles(dir, 1_000);
    writeFileSync(path.join(dir, "added-after.ts"), "x\n");
    expect(projectFiles(dir, 1_100)).toBe(first);
    // And reads again once the listing is stale.
    expect(projectFiles(dir, 1_000_000)).toContain("added-after.ts");
  });
});

describe("ranking", () => {
  const files = [
    "apps/web/src/components/chat/index.ts",
    "apps/web/src/index.ts",
    "index.ts",
    "packages/shared/src/composerDraftStore.ts",
    "docs/indexing.md",
  ];

  it("puts an exact file name first, then a prefix, then the rest", () => {
    // Walk order is not an answer: "index" used to return whichever files the
    // walk reached first.
    expect(rankFiles(files, "index.ts").map((file) => file.path)).toEqual([
      "index.ts",
      "apps/web/src/index.ts",
      "apps/web/src/components/chat/index.ts",
    ]);
  });

  it("matches a path typed with separators", () => {
    expect(rankFiles(files, "shared/composer")[0]?.path).toBe(
      "packages/shared/src/composerDraftStore.ts",
    );
  });

  it("says nothing rather than everything for a query that matches nothing", () => {
    expect(rankFiles(files, "zzz")).toEqual([]);
  });

  it("scores a name before the folders above it", () => {
    expect(scorePath("a/b/index.ts", "index")).toBeLessThan(scorePath("index/other.ts", "index")!);
  });
});

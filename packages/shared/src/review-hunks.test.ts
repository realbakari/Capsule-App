import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff.js";
import { hunkActions, hunkPatch, hunkStage, quoteGitPath, type ReviewFileDiffs } from "./review-hunks.js";

const twoHunks = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@ export function app() {",
  " one",
  "-two",
  "+TWO",
  " three",
  "@@ -20,3 +20,4 @@ function tail() {",
  " twenty",
  " twenty-one",
  "+inserted",
  " twenty-two",
  "",
].join("\n");

function only(text: string) {
  const [file] = parseUnifiedDiff(text);
  if (!file) throw new Error("no file");
  return file;
}

describe("hunkPatch", () => {
  it("keeps one hunk of a multi-hunk file, with its own header and heading", () => {
    expect(hunkPatch(only(twoHunks), [1])).toBe([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -20,3 +20,4 @@ function tail() {",
      " twenty",
      " twenty-one",
      "+inserted",
      " twenty-two",
      "",
    ].join("\n"));
  });

  it("writes several hunks in file order whatever order they are picked in", () => {
    const patch = hunkPatch(only(twoHunks), [1, 0, 1]);
    expect(patch.indexOf("@@ -1,3")).toBeLessThan(patch.indexOf("@@ -20,3"));
    expect(patch.match(/@@ -20/g)).toHaveLength(1);
  });

  it("carries a missing final newline on whichever side had it", () => {
    const file = only([
      "diff --git a/n.txt b/n.txt",
      "--- a/n.txt",
      "+++ b/n.txt",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n"));
    expect(file.hunks[0]!.lines.map((line) => line.noNewline ?? false)).toEqual([false, true, true]);
    expect(hunkPatch(file, [0])).toContain("-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n");
  });

  it("edits a renamed file where it now is rather than moving it again", () => {
    const file = only([
      "diff --git a/old/name.ts b/new/name.ts",
      "similarity index 90%",
      "rename from old/name.ts",
      "rename to new/name.ts",
      "index 1111111..2222222 100644",
      "--- a/old/name.ts",
      "+++ b/new/name.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n"));
    const patch = hunkPatch(file, [0]);
    expect(patch.startsWith("diff --git a/new/name.ts b/new/name.ts\n--- a/new/name.ts\n+++ b/new/name.ts\n")).toBe(true);
    expect(patch).not.toContain("rename");
    expect(patch).not.toContain("old/name.ts");
  });

  it("keeps carriage returns byte for byte", () => {
    const file = only("diff --git a/w.txt b/w.txt\n--- a/w.txt\n+++ b/w.txt\n@@ -1,2 +1,2 @@\n a\r\n-b\r\n+c\r\n");
    expect(file.hunks[0]!.lines.map((line) => line.text)).toEqual(["a\r", "b\r", "c\r"]);
    expect(hunkPatch(file, [0])).toContain("\n a\r\n-b\r\n+c\r\n");
  });

  it("creates and deletes whole files with their mode", () => {
    const created = only("diff --git a/bin/run b/bin/run\nnew file mode 100755\nindex 0000000..1111111\n--- /dev/null\n+++ b/bin/run\n@@ -0,0 +1 @@\n+echo hi\n");
    expect(hunkPatch(created, [0])).toBe("diff --git a/bin/run b/bin/run\nnew file mode 100755\n--- /dev/null\n+++ b/bin/run\n@@ -0,0 +1 @@\n+echo hi\n");
    const deleted = only("diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n");
    expect(hunkPatch(deleted, [0])).toBe("diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n");
  });

  it("quotes paths the way git does", () => {
    expect(quoteGitPath("a/plain name.ts")).toBe("a/plain name.ts");
    expect(quoteGitPath("a/é.ts")).toBe("a/é.ts");
    expect(quoteGitPath('a/tab\there "q"\\.ts')).toBe('"a/tab\\there \\"q\\"\\\\.ts"');
    expect(quoteGitPath("a/bell\x07\x01.ts")).toBe('"a/bell\\a\\001.ts"');
    const file = only('diff --git "a/tab\\there.ts" "b/tab\\there.ts"\n--- "a/tab\\there.ts"\n+++ "b/tab\\there.ts"\n@@ -1 +1 @@\n-x\n+y\n');
    expect(file.path).toBe("tab\there.ts");
    expect(hunkPatch(file, [0]).split("\n")[0]).toBe('diff --git "a/tab\\there.ts" "b/tab\\there.ts"');
  });
});

describe("hunkActions", () => {
  const combined = only(twoHunks);
  // The first hunk is staged; the second is still only in the working tree.
  const staged = only("diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n");
  const unstaged = only("diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -20,3 +20,4 @@\n twenty\n twenty-one\n+inserted\n twenty-two\n");
  const diffs: ReviewFileDiffs = { shown: combined, staged, unstaged };

  it("tells staged, unstaged and mixed combined hunks apart", () => {
    expect([hunkStage(diffs, 0), hunkStage(diffs, 1)]).toEqual(["staged", "unstaged"]);
    const both = only("diff --git a/m.ts b/m.ts\n--- a/m.ts\n+++ b/m.ts\n@@ -1,3 +1,3 @@\n one\n-two\n-three\n+TWO\n+THREE\n");
    const stagedTwo = only("diff --git a/m.ts b/m.ts\n--- a/m.ts\n+++ b/m.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n");
    const unstagedThree = only("diff --git a/m.ts b/m.ts\n--- a/m.ts\n+++ b/m.ts\n@@ -1,3 +1,3 @@\n one\n TWO\n-three\n+THREE\n");
    expect(hunkStage({ shown: both, staged: stagedTwo, unstaged: unstagedThree }, 0)).toBe("partly");
  });

  it("keeps the unstaged part of an Uncommitted hunk and leaves the staged part alone", () => {
    const actions = hunkActions("uncommitted", diffs, [1]);
    expect(actions.keep).toEqual({ index: { patch: hunkPatch(unstaged, [0]), reverse: false } });
    expect(actions.unstage).toBeUndefined();
    expect(actions.reject).toEqual({ worktree: { patch: hunkPatch(combined, [1]), reverse: true } });
  });

  it("rejects a staged Uncommitted hunk from both the index and the working tree", () => {
    const actions = hunkActions("uncommitted", diffs, [0]);
    expect(actions.keep).toBeUndefined();
    expect(actions.unstage).toEqual({ index: { patch: hunkPatch(staged, [0]), reverse: true } });
    expect(actions.reject).toEqual({
      worktree: { patch: hunkPatch(combined, [0]), reverse: true },
      index: { patch: hunkPatch(staged, [0]), reverse: true },
    });
  });

  it("offers what each scope can do and nothing on read-only scopes", () => {
    expect(Object.keys(hunkActions("unstaged", { shown: unstaged }, [0])).sort()).toEqual(["keep", "reject"]);
    expect(Object.keys(hunkActions("staged", { shown: staged }, [0]))).toEqual(["unstage"]);
    expect(hunkActions("staged", { shown: staged }, [0]).unstage).toEqual({ index: { patch: hunkPatch(staged, [0]), reverse: true } });
    expect(hunkActions("turn", { shown: combined }, [0])).toEqual({});
    expect(hunkActions("branch", { shown: combined }, [0])).toEqual({});
    expect(hunkActions("unstaged", { shown: { ...unstaged, binary: true, hunks: [] } }, [])).toEqual({});
  });
});

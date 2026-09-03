import { describe, expect, it } from "vitest";

import { parseUnifiedDiff, splitRows, type DiffHunk } from "./diff.js";

const PATCH = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -10,6 +10,7 @@ export function one() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  const c = 4;
   return a;
 }
diff --git a/src/two.ts b/src/two.ts
new file mode 100644
--- /dev/null
+++ b/src/two.ts
@@ -0,0 +1,2 @@
+export const two = 2;
+
`;

describe("reading a patch", () => {
  it("splits it into files rather than one wall of text", () => {
    const files = parseUnifiedDiff(PATCH);
    expect(files.map((file) => file.path)).toEqual(["src/one.ts", "src/two.ts"]);
  });

  it("counts what each file added and removed", () => {
    const [one, two] = parseUnifiedDiff(PATCH);
    expect({ additions: one!.additions, deletions: one!.deletions }).toEqual({
      additions: 2,
      deletions: 1,
    });
    expect(two!.status).toBe("added");
    expect(two!.deletions).toBe(0);
  });

  it("numbers the lines on both sides", () => {
    /*
     * Without these there is nothing to point at: no line to cite in a review,
     * and no way to say where in the file a change sits.
     */
    const [one] = parseUnifiedDiff(PATCH);
    const lines = one!.hunks[0]!.lines;
    expect(lines[0]).toMatchObject({ kind: "context", oldLine: 10, newLine: 10 });
    expect(lines[1]).toMatchObject({ kind: "del", text: "  const b = 2;", oldLine: 11 });
    expect(lines[2]).toMatchObject({ kind: "add", text: "  const b = 3;", newLine: 11 });
    expect(lines[3]).toMatchObject({ kind: "add", text: "  const c = 4;", newLine: 12 });
    // The line after two additions is the same source line, further down the
    // right-hand side than the left.
    expect(lines[4]).toMatchObject({ kind: "context", oldLine: 12, newLine: 13 });
  });

  it("keeps a deleted file under the name it had", () => {
    const files = parseUnifiedDiff(`diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const gone = true;
`);
    expect(files[0]).toMatchObject({ path: "gone.ts", status: "deleted", deletions: 1 });
  });

  it("reads a rename that carries no hunks at all", () => {
    const files = parseUnifiedDiff(`diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
`);
    expect(files[0]).toMatchObject({
      path: "new/name.ts",
      oldPath: "old/name.ts",
      status: "renamed",
    });
  });

  it("says a binary file is binary instead of showing nothing", () => {
    const files = parseUnifiedDiff(`diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`);
    expect(files[0]).toMatchObject({ path: "logo.png", binary: true });
  });

  it("does not count the no-newline marker as a line", () => {
    const files = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
\\ No newline at end of file
`);
    expect(files[0]!.hunks[0]!.lines).toHaveLength(2);
    expect(files[0]!.additions).toBe(1);
  });

  it("reads a hunk header written without counts", () => {
    // `@@ -1 +1 @@` is legal and appears whenever a side is a single line.
    const files = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -5 +7 @@
-a
+b
`);
    expect(files[0]!.hunks[0]).toMatchObject({ oldStart: 5, newStart: 7 });
    expect(files[0]!.hunks[0]!.lines[0]!.oldLine).toBe(5);
    expect(files[0]!.hunks[0]!.lines[1]!.newLine).toBe(7);
  });

  it("returns nothing for an empty patch rather than a file with no name", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n")).toEqual([]);
  });
});

describe("pairing lines for a side-by-side view", () => {
  const hunk = (lines: DiffHunk["lines"]): DiffHunk => ({
    header: "@@",
    oldStart: 1,
    newStart: 1,
    lines,
  });

  it("puts a replaced line opposite the line that replaced it", () => {
    const rows = splitRows(
      hunk([
        { kind: "del", text: "was", oldLine: 1 },
        { kind: "add", text: "is", newLine: 1 },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.left?.text).toBe("was");
    expect(rows[0]!.right?.text).toBe("is");
  });

  it("leaves the shorter side blank when the runs are uneven", () => {
    const rows = splitRows(
      hunk([
        { kind: "del", text: "was", oldLine: 1 },
        { kind: "add", text: "is", newLine: 1 },
        { kind: "add", text: "and also", newLine: 2 },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.left).toBeUndefined();
    expect(rows[1]!.right?.text).toBe("and also");
  });

  it("keeps context on both sides so the columns stay aligned", () => {
    const rows = splitRows(
      hunk([
        { kind: "context", text: "same", oldLine: 1, newLine: 1 },
        { kind: "del", text: "was", oldLine: 2 },
      ]),
    );
    expect(rows[0]?.left).toBe(rows[0]?.right);
    expect(rows[1]?.right).toBeUndefined();
  });
});

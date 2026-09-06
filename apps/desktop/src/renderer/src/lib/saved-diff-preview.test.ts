import { describe, expect, it } from "vitest";
import { PREVIEW_LINE_CHARS, PREVIEW_PATCH_LINES, savedDiffPreview } from "./saved-diff-preview";

const edit = (path: string, before = "const oldValue = 1;", after = "const newValue = 2;") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -2023,2 +2023,2 @@\n ${"// context"}\n-${before}\n+${after}\n`;

describe("saved diff excerpts", () => {
  it("selects the exact file, retaining original line numbers and change signs", () => {
    const patch = edit("a/index.ts", "wrong", "wrong") + edit("b/index.ts");
    const preview = savedDiffPreview(patch, "b/index.ts");
    expect(preview?.truncated).toBe(false);
    expect(preview?.file.hunks[0]?.lines).toEqual([
      { kind: "context", text: "// context", oldLine: 2023, newLine: 2023 },
      { kind: "del", text: "const oldValue = 1;", oldLine: 2024 },
      { kind: "add", text: "const newValue = 2;", newLine: 2024 },
    ]);
    expect(savedDiffPreview(patch, "index.ts")).toBeUndefined();
    expect(savedDiffPreview(patch, "/some/current/b/index.ts")).toBeUndefined();
  });

  it("handles spaced and Git-quoted UTF-8 paths, and renames without hunks", () => {
    expect(savedDiffPreview(edit("folder with spaces/code.ts"), "folder with spaces/code.ts")?.file.path).toBe("folder with spaces/code.ts");
    const patch = 'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251-new.ts"\nsimilarity index 100%\nrename from "caf\\303\\251.ts"\nrename to "caf\\303\\251-new.ts"\n';
    expect(savedDiffPreview(patch, "café-new.ts")?.file.status).toBe("renamed");
    expect(savedDiffPreview(patch, "café.ts")?.file.oldPath).toBe("café.ts");
  });

  it("preserves deleted, added and binary states", () => {
    const patch = "diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n";
    expect(savedDiffPreview(patch, "a.png")?.file.binary).toBe(true);
    const added = "diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hello\n";
    expect(savedDiffPreview(added, "new.ts")?.file.status).toBe("added");
    const deleted = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-goodbye\n";
    expect(savedDiffPreview(deleted, "old.ts")?.file.status).toBe("deleted");
  });

  it("bounds the parsed excerpt and still finds a file after a very large edit", () => {
    const patch = "diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -0,0 +1,20000 @@\n" + "+line\n".repeat(20_000) + edit("last.ts");
    const preview = savedDiffPreview(patch, "big.ts");
    expect(preview?.truncated).toBe(true);
    expect(preview!.file.hunks.flatMap((hunk) => hunk.lines).length).toBeLessThan(PREVIEW_PATCH_LINES);
    expect(savedDiffPreview(patch, "last.ts")?.truncated).toBe(false);
  });

  it("bounds long lines and never interprets embedded markup as HTML", () => {
    const preview = savedDiffPreview(edit("long.ts", "x".repeat(3000), '<script>alert("x")</script>'), "long.ts");
    expect(preview?.truncated).toBe(true);
    expect(preview?.file.hunks[0]?.lines[1]?.text.length).toBe(PREVIEW_LINE_CHARS + 1);
    expect(preview?.file.hunks[0]?.lines[2]?.text).toBe('<script>alert("x")</script>');
    expect(savedDiffPreview("", "missing.ts")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { isUnifiedDiff } from "./run-output";

describe("isUnifiedDiff", () => {
  it("knows a git diff and a plain unified diff", () => {
    expect(isUnifiedDiff("diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n")).toBe(true);
    expect(isUnifiedDiff("--- old.txt\n+++ new.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n")).toBe(true);
  });

  it("leaves prose, lists and a lone separator as Markdown", () => {
    expect(isUnifiedDiff("Blocked: **secret** in prompt\n- one\n- two")).toBe(false);
    expect(isUnifiedDiff("---\ntitle\n---")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { insertBlock, SELECTION_MAX_LINES, terminalSnippet } from "./terminal-selection.js";

describe("terminalSnippet", () => {
  it("fences the selection under the tab's name without trailing padding", () => {
    expect(terminalSnippet("\n$ pnpm test   \r\nFAIL a.test.ts  \n\n", "web")?.text).toBe(
      "Terminal output from web:\n```text\n$ pnpm test\nFAIL a.test.ts\n```",
    );
  });

  it("ignores a blank selection", () => {
    expect(terminalSnippet("  \n \n", "web")).toBeUndefined();
  });

  it("uses a longer fence than any run of backticks inside", () => {
    expect(terminalSnippet("echo ```", "web")?.text).toContain("````text\necho ```\n````");
  });

  it("keeps the end of a long selection and says how much is left out", () => {
    const lines = Array.from({ length: SELECTION_MAX_LINES + 50 }, (_, index) => `line ${index}`);
    const snippet = terminalSnippet(lines.join("\n"), "web")!;
    expect(snippet.omittedLines).toBe(50);
    expect(snippet.text).toContain(`line ${SELECTION_MAX_LINES + 49}\n`);
    expect(snippet.text).not.toContain("line 49\n");
    expect(snippet.text).toMatch(/\(Trimmed: the first 50 of 250 selected lines are left out\.\)$/);
  });
});

describe("insertBlock", () => {
  it("puts the block in its own paragraph at the caret and puts the caret after it", () => {
    expect(insertBlock("", 0, "B")).toEqual({ draft: "B\n\n", caret: 3 });
    expect(insertBlock("Why does this fail?", 19, "B")).toEqual({ draft: "Why does this fail?\n\nB\n\n", caret: 24 });
    expect(insertBlock("Before after", 7, "B")).toEqual({ draft: "Before \n\nB\n\nafter", caret: 12 });
    expect(insertBlock("one\n\ntwo", 5, "B")).toEqual({ draft: "one\n\nB\n\ntwo", caret: 8 });
  });
});

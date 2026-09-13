import { describe, expect, it } from "vitest";
import { titleFromPrompt } from "./index.js";

describe("first-prompt titles", () => {
  it("uses a readable first line rather than appending pasted details", () => {
    expect(titleFromPrompt("\n## Fix the `sidebar`\n\nHere is a long log")).toBe("Fix the sidebar");
    expect(titleFromPrompt("Review [the change](https://example.test/long/path)")).toBe("Review the change");
  });
  it("keeps short prompts and a stable empty fallback", () => {
    expect(titleFromPrompt(" Review   recent PRs ")).toBe("Review recent PRs");
    expect(titleFromPrompt("\n  ")).toBe("New conversation");
  });
  it("does not split a word or a Unicode character at the limit", () => {
    const title = titleFromPrompt("Review the existing conversation composer and implement readable improvements to the activity timeline");
    expect(title).toBe("Review the existing conversation composer and implement readable…");
    expect(Array.from(titleFromPrompt("𐐀".repeat(100)))).toHaveLength(72);
  });
});

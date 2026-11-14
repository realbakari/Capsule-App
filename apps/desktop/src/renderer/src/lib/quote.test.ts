import { describe, expect, it } from "vitest";
import { insertBlock } from "./terminal-selection";
import { quoteMarkdown } from "./quote";

describe("quoting a reply", () => {
  it("quotes every line and keeps paragraph breaks", () => {
    expect(quoteMarkdown("Use SQLite.\n\nIt is one file.\n\n")).toBe("> Use SQLite.\n>\n> It is one file.");
  });

  it("goes into the draft as its own paragraph at the caret", () => {
    expect(insertBlock("Why?", 0, quoteMarkdown("Use SQLite.")).draft.startsWith("> Use SQLite.\n")).toBe(true);
  });
});

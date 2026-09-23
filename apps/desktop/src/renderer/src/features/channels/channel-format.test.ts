import { describe, expect, it } from "vitest";
import { formatChannelSelection } from "./channel-format";
import { editMentions } from "./mentions";
describe("channel formatting", () => {
  it("wraps selections and selects placeholders in empty ranges", () => {
    expect(formatChannelSelection("hello", 0, 5, "Bold")).toMatchObject({ content: "**hello**", start: 2, end: 7 });
    expect(formatChannelSelection("", 0, 0, "Italic")).toMatchObject({ content: "_italic text_", start: 1, end: 12 });
    expect(formatChannelSelection("code", 0, 4, "Code block").content).toBe("\n```\ncode\n```\n");
  });
  it("preserves signed identities when wrapping a selected mention", () => {
    const content = "Hello @Reviewer";
    const mentions = [{ start: 6, end: 15, text: "@Reviewer", pubkey: "a".repeat(64) }];
    const result = formatChannelSelection(content, 6, 15, "Bold");
    expect(editMentions(result.before, result.content, editMentions(content, result.before, mentions))).toEqual([{ ...mentions[0], start: 8, end: 17 }]);
  });
});

import { describe, expect, it } from "vitest";
import { editMentions, mentionQuery, mentionedText } from "./mentions";

const member = { pubkey: "a".repeat(64), name: "Alex Jones", role: "member" };
describe("channel mentions", () => {
  const before = "Hello @Alex Jones today";
  const mention = { start: 6, end: 17, text: "@Alex Jones", pubkey: member.pubkey };
  it("keeps exact selected identities across surrounding edits", () => {
    expect(editMentions(before, `Say ${before}`, [mention])).toEqual([{ ...mention, start: 10, end: 21 }]);
    expect(editMentions(before, before + "!", [mention])).toEqual([mention]);
    expect(editMentions(before, before.replace("Hello ", ""), [mention])).toEqual([{ ...mention, start: 0, end: 11 }]);
  });
  it("drops recipients when their token is deleted or edited", () => {
    expect(editMentions(before, "Hello today", [mention])).toEqual([]);
    expect(editMentions(before, before.replace("Alex", "Alec"), [mention])).toEqual([]);
    expect(editMentions(before, "", [mention])).toEqual([]);
    expect(editMentions(before, before.replace("Jones", "Jonesville"), [mention])).toEqual([]);
    expect(editMentions(before, before.replace("@", "mail@"), [mention])).toEqual([]);
  });
  it("finds typed names at the caret, not email addresses", () => {
    expect(mentionQuery("Hi @Alex Jo", 11)).toEqual({ start: 3, query: "Alex Jo" });
    expect(mentionQuery("me@example.test", 15)).toBeUndefined();
    expect(mentionQuery("Hello\n@", 7)).toEqual({ start: 6, query: "" });
  });
  it("decorates only tagged, unambiguous, complete names", () => {
    expect(mentionedText("Hi @Alex Jones!", [member], [member.pubkey])).toEqual([{ text: "Hi " }, { text: "@Alex Jones", member }, { text: "!" }]);
    expect(mentionedText("Hi @Alex Jones!", [member], [])).toEqual([{ text: "Hi @Alex Jones!" }]);
    expect(mentionedText("@Alex Jonesville", [member], [member.pubkey])).toEqual([{ text: "@Alex Jonesville" }]);
    expect(mentionedText("@Alex Jones", [member, { ...member, pubkey: "b".repeat(64) }], [member.pubkey])).toEqual([{ text: "@Alex Jones" }]);
  });
});

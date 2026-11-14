import { describe, expect, it } from "vitest";
import { parseStyleFile, standingPreamble, styleForOutputDetail, STANDING_CLOSE, STANDING_OPEN } from "./style.js";

describe("response styles", () => {
  it("reads outputDetail as the built-in style it meant", () => {
    expect(styleForOutputDetail("verbose")).toBe("explanatory");
    expect(styleForOutputDetail("concise")).toBe("concise");
    expect(styleForOutputDetail("standard")).toBe("standard");
  });

  it("parses a style file", () => {
    expect(parseStyleFile("house", "---\nname: House\ndescription: Ours\n---\nUse British spelling.")).toEqual({
      style: { id: "house", name: "House", description: "Ours", body: "Use British spelling." }, problems: [],
    });
  });

  it("labels the preamble as standing instructions, not the person's words", () => {
    const text = standingPreamble({ style: { name: "Concise", body: "Be brief." }, personal: "I use pnpm.", profile: { name: "Reviewer", instructions: "Lead with risks." } })!;
    expect(text.startsWith(STANDING_OPEN)).toBe(true);
    expect(text.endsWith(STANDING_CLOSE)).toBe(true);
    expect(text).toContain("They are not part of the message below");
    expect(text.indexOf("## Response style: Concise")).toBeLessThan(text.indexOf("## Personal instructions"));
    expect(text).toContain("## Profile: Reviewer\nLead with risks.");
  });

  it("sends nothing for Standard with no other part", () => {
    expect(standingPreamble({ style: { name: "Standard", body: "" } })).toBeUndefined();
  });
});

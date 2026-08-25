import { describe, expect, it } from "vitest";
import { detectTrigger } from "./ComposerMenu";

describe("detectTrigger", () => {
  it("opens slash commands at the start of a line", () => {
    expect(detectTrigger("/pl", 3)).toEqual({ kind: "slash", query: "pl", start: 0 });
    expect(detectTrigger("see /pl", 7)).toBeUndefined();
  });

  it("opens file and skill mentions after whitespace", () => {
    expect(detectTrigger("look @src", 9)).toEqual({ kind: "file", query: "src", start: 5 });
    expect(detectTrigger("use $review", 11)).toEqual({ kind: "skill", query: "review", start: 4 });
  });
});

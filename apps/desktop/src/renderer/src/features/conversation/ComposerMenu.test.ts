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

  it("opens file mentions after an opening bracket or quote, not inside a word", () => {
    expect(detectTrigger("see (@src", 9)).toEqual({ kind: "file", query: "src", start: 5 });
    expect(detectTrigger("edit \"@app", 10)).toEqual({ kind: "file", query: "app", start: 6 });
    expect(detectTrigger("[@lib", 5)).toEqual({ kind: "file", query: "lib", start: 1 });
    expect(detectTrigger("mail me@host", 12)).toBeUndefined();
  });

  it("leaves a pasted path alone, wherever the caret is in it", () => {
    const path = "/Users/me/app.log";
    expect(detectTrigger(path, path.length)).toBeUndefined();
    expect(detectTrigger(path, 3)).toBeUndefined();
    expect(detectTrigger(`look\n${path}`, 8)).toBeUndefined();
    expect(detectTrigger("/", 1)).toEqual({ kind: "slash", query: "", start: 0 });
  });

  it("reads an amount of money as money, not a skill", () => {
    for (const amount of ["$5", "$10k", "$1,200.50", "$.50", "($5)"]) expect(detectTrigger(`costs ${amount}`, 6 + amount.length)).toBeUndefined();
    expect(detectTrigger("use $3d-model", 13)).toEqual({ kind: "skill", query: "3d-model", start: 4 });
  });
});

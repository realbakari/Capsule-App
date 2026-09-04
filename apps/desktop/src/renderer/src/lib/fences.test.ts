import { describe, expect, it } from "vitest";
import { splitFences } from "./fences.js";

describe("splitFences", () => {
  it("returns prose unchanged when there is no fence", () => {
    expect(splitFences("Just prose.")).toEqual([{ kind: "prose", text: "Just prose." }]);
  });

  it("keeps prose on both sides of a closed fence", () => {
    // The regression: a closed fence adds a second capture slot, so the prose
    // after it landed on a code index and `undefined` reached the renderer.
    expect(splitFences("A\n```ts\ncode\n```\nB")).toEqual([
      { kind: "prose", text: "A\n" },
      { kind: "code", text: "code", language: "ts" },
      { kind: "prose", text: "B" },
    ]);
  });

  it("handles a fence with no language", () => {
    expect(splitFences("A\n```\ncode\n```\nB")).toEqual([
      { kind: "prose", text: "A\n" },
      { kind: "code", text: "code" },
      { kind: "prose", text: "B" },
    ]);
  });

  it("handles several blocks in one reply", () => {
    const segments = splitFences("one\n```js\na\n```\ntwo\n```sh\nb\n```\nthree");
    expect(segments.map((s) => s.kind)).toEqual(["prose", "code", "prose", "code", "prose"]);
    expect(segments.filter((s) => s.kind === "code").map((s) => s.language)).toEqual(["js", "sh"]);
  });

  it("tolerates an unclosed fence — streaming replies arrive mid-block", () => {
    expect(splitFences("A\n```ts\ncode")).toEqual([
      { kind: "prose", text: "A\n" },
      { kind: "code", text: "code", language: "ts" },
    ]);
  });

  it("never emits an undefined segment", () => {
    for (const sample of ["```", "```ts", "a```b```c", "", "```\n```"]) {
      for (const segment of splitFences(sample)) {
        expect(typeof segment.text).toBe("string");
      }
    }
  });

  it("keeps shorter fences inside longer examples literal", () => {
    expect(splitFences('````md\n```ts\nconst x = 1;\n```\n````\nAfter')).toEqual([
      { kind: "code", text: '```ts\nconst x = 1;\n```', language: "md" }, { kind: "prose", text: "After" },
    ]);
  });
  it("supports tilde fences, non-word languages and longer closing fences", () => {
    expect(splitFences('~~~c++\r\nint x = 1;\r\n~~~~\r\nAfter')).toEqual([
      { kind: "code", text: "int x = 1;", language: "c++" }, { kind: "prose", text: "After" },
    ]);
  });
  it("does not mistake backticks inside prose for block fences", () => {
    expect(splitFences('Use ``` as a delimiter.')).toEqual([{ kind: "prose", text: 'Use ``` as a delimiter.' }]);
  });
});

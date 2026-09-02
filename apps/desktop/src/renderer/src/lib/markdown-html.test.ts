import { describe, expect, it } from "vitest";

import { stripHtmlComments, stripInlineTags } from "./markdown-html";

describe("stripHtmlComments", () => {
  it("removes the metadata bots leave in a pull-request body", () => {
    expect(stripHtmlComments('<!-- macroscope-meta: {"kind":"x"} -->\nVerdict: Approved')).toBe(
      "\nVerdict: Approved",
    );
  });

  it("removes one that spans lines", () => {
    expect(stripHtmlComments("a\n<!-- one\ntwo -->\nb")).toBe("a\n\nb");
  });

  it("closes the gap a stripped block leaves behind", () => {
    expect(stripHtmlComments("a\n\n<!-- x -->\n\nb")).toBe("a\n\nb");
  });

  it("leaves prose alone", () => {
    expect(stripHtmlComments("2 < 3 and 4 > 1")).toBe("2 < 3 and 4 > 1");
  });
});

describe("stripInlineTags", () => {
  it("keeps the text and drops the tag", () => {
    expect(stripInlineTags("<sup>You can adjust rules.</sup>")).toBe("You can adjust rules.");
  });

  it("handles attributes and self-closing forms", () => {
    expect(stripInlineTags('a<br />b<span class="x">c</span>')).toBe("abc");
  });

  it("leaves a comparison alone", () => {
    expect(stripInlineTags("if (a < b) return a > c;")).toBe("if (a < b) return a > c;");
  });

  it("leaves tags it does not know alone, rather than guessing", () => {
    expect(stripInlineTags("<Widget /> renders")).toBe("<Widget /> renders");
  });
});

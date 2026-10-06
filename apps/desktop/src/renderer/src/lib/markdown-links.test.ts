import { describe, expect, it } from "vitest";
import { markdownFilePath, parseMarkdown } from "./markdown";

function destinations(source: string) {
  return parseMarkdown(source).tokens.flatMap((token) => token.children ?? [])
    .flatMap((token) => {
      const href = token.attrGet("href") ?? token.attrGet("src");
      return typeof href === "string" ? [href] : [];
    });
}

it("preserves Windows separators in named links, images, and references", () => {
  for (const source of [String.raw`[Config](C:\repo\.config\settings.json)`, String.raw`![Config](C:\repo\.config\settings.json)`, String.raw`[Config][config]

[config]: C:\repo\.config\settings.json`]) {
    expect(destinations(source).map((href) => markdownFilePath(href))).toEqual([String.raw`C:\repo\.config\settings.json`]);
  }
  expect(destinations('[Notes](<C:\\My Project\\.notes\\readme.md> "Title")').map((href) => markdownFilePath(href)))
    .toEqual([String.raw`C:\My Project\.notes\readme.md`]);
  expect(destinations(String.raw`[Web](https://example.test/a\(b\))`)).toEqual(["https://example.test/a(b)"]);
});

it("resolves local links without altering descriptive labels or loading code examples", () => {
  expect(markdownFilePath("src/app.ts#L12C3")).toBe("src/app.ts:12:3");
  expect(markdownFilePath("file:///work/My%20Project/app.ts")).toBe("/work/My Project/app.ts");
  expect(markdownFilePath("file:///C:/work/app.ts")).toBe("C:/work/app.ts");
  expect(destinations("[App](file:///work/app.ts)")).toEqual(["file:///work/app.ts"]);
  expect(destinations("`[App](C:\\repo\\.notes\\app.ts)`")).toEqual([]);
  expect(destinations("```md\n[App](C:\\repo\\.notes\\app.ts)\n```")).toEqual([]);
});

describe("local link boundary", () => {
  it.each(["javascript:alert(1)", "data:text/plain,file.txt", "https://example.test/app.ts", "file://server/share/app.ts", "//server/share/app.ts", String.raw`\\server\share\app.ts`, "file:///work/a.ts?download=1", "src/%00file.ts", "src/%0afile.ts", "src/%E0%A4%A.ts", "#section", "src/app.ts?download=1"])("does not activate %s", (href) => {
    expect(markdownFilePath(href)).toBeUndefined();
  });
  it("keeps review links on their web host even when a file handler exists", () => {
    expect(markdownFilePath("src/app.ts", "https://example.test/review/")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { highlight } from "./highlight.js";

const render = (code: string, lang?: string) =>
  renderToStaticMarkup(highlight(code, lang) as never);

describe("highlight", () => {
  it("colours strings, comments, numbers and keywords", () => {
    const html = render('const x = "hi"; // note\nconst n = 42;', "js");
    expect(html).toContain('class="tok-kw"');
    expect(html).toContain('class="tok-str"');
    expect(html).toContain('class="tok-com"');
    expect(html).toContain('class="tok-num"');
  });

  it("never loses or reorders the original text", () => {
    const code = 'const path = "/a/b"; # shell comment\nls -la 99';
    // Strip the spans, then undo React's entity escaping: what remains must be
    // byte-identical to the input.
    const text = render(code, "sh")
      .replace(/<[^>]*>/g, "")
      .replaceAll("&quot;", '"')
      .replaceAll("&#x27;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    expect(text).toBe(code);
  });

  it("escapes markup rather than emitting it", () => {
    // A reply containing HTML must never become HTML.
    const html = render('const a = "<img src=x onerror=alert(1)>";', "js");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("leaves prose fences uncoloured", () => {
    expect(render("const is not a keyword here", "markdown")).toBe("const is not a keyword here");
  });

  it("gives up on very large blocks instead of chewing through them", () => {
    const big = "const x = 1;\n".repeat(3_000);
    expect(render(big, "js")).toBe(big.replace(/</g, "&lt;"));
  });

  it("handles an empty block", () => {
    expect(render("", "js")).toBe("");
  });
});

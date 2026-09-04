import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearHighlightCache, highlight } from "./highlight.js";

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
  it("returns the same tokenised tree for an unchanged block", () => {
    /*
     * The point of the cache: a streamed reply re-renders on every chunk, and
     * the fences that already finished arriving must not be tokenised again.
     * Identity is the observable proof that no second pass happened.
     */
    clearHighlightCache();
    const code = 'const greeting = "hello"; // a note';
    expect(highlight(code, "ts")).toBe(highlight(code, "ts"));
  });

  it("does not confuse two blocks that differ only by language", () => {
    clearHighlightCache();
    const code = "const x = 1;";
    expect(highlight(code, "ts")).not.toBe(highlight(code, "python"));
    // ...and the earlier one is still itself, not overwritten by the later.
    expect(render(code, "ts")).toContain("tok-kw");
  });

  it("keeps a separator in the code from colliding with the language", () => {
    clearHighlightCache();
    // "ts" + NUL + "x" must not key the same as "" + NUL + "ts\u0000x".
    const a = highlight("x", "ts");
    const b = highlight("ts\u0000x", undefined);
    expect(a).not.toBe(b);
  });

  it("bounds what it retains rather than growing for the whole session", () => {
    clearHighlightCache();
    const first = "const first = 1;";
    const original = highlight(first, "ts");
    // Push well past the limit, so the first entry cannot still be held.
    for (let i = 0; i < 40; i += 1) highlight(`const filler${i} = ${i};`, "ts");
    // Evicted, so this is tokenised afresh rather than handed back.
    expect(highlight(first, "ts")).not.toBe(original);
  });
});

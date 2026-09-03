import { describe, expect, it } from "vitest";

import { inline, toHtml } from "./build-policy-pages.mjs";

describe("the policy markdown converter", () => {
  it("escapes what it does not recognise rather than trusting it", () => {
    // These are our own files, but a converter that emits whatever it is handed
    // is one edit away from being a hole.
    expect(inline('<script>alert(1)</script>')).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(toHtml("a & b < c")).toBe("<p>a &amp; b &lt; c</p>");
  });

  it("renders the shapes these documents use", () => {
    expect(toHtml("## Privacy")).toBe("<h3>Privacy</h3>");
    expect(toHtml("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(toHtml("1. first")).toBe("<ol>\n<li>first</li>\n</ol>");
    expect(toHtml("---")).toBe("<hr />");
    expect(toHtml("`code`")).toBe("<p><code>code</code></p>");
    expect(toHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
  });

  it("joins a wrapped paragraph rather than breaking every line", () => {
    expect(toHtml("one\ntwo\n\nthree")).toBe("<p>one two</p>\n<p>three</p>");
  });

  it("builds a table", () => {
    const html = toHtml("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("opens an external link in a new tab and points a repo link at GitHub", () => {
    expect(inline("[docs](https://example.com)")).toContain('target="_blank"');
    expect(inline("[licence](LICENSE)")).toContain(
      'href="https://github.com/realbakari/Capsule-App/blob/main/LICENSE"',
    );
  });

  it("turns a bare autolink into a link", () => {
    expect(inline("<https://example.com/x>")).toContain('href="https://example.com/x"');
  });

  it("does not linkify something that is not a URL", () => {
    expect(inline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
});

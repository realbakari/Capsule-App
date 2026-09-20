import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MessageBody";

const render = (content: string, githubBaseUrl?: string) =>
  renderToStaticMarkup(createElement(MarkdownBody, { content, githubBaseUrl }));

describe.each([undefined, "https://github.com/example/repo/pull/1"])("Markdown correctness (%s)", (base) => {
  it("bounds quote nesting without dropping the remaining text", () => {
    const html = render("> ".repeat(8000) + "Still readable", base);
    expect(html).toContain("Still readable");
  });

  it("preserves HTML examples in inline code and nested code fences", () => {
    const html = render('Use `<!-- example -->`.\n\n> ```html\n> <div>Example</div>\n> <!-- literal -->\n> ```', base);
    expect(html).toContain("&lt;!-- example --&gt;");
    expect(html).toContain('class="msg-code-wrap"');
    expect(html).toContain("literal");
    expect(html).not.toContain("```html");
    expect(html).not.toContain("<div>Example</div>");
  });

  it("ends a table before the following list without losing pipes or text", () => {
    const html = render('| Field | Value |\n| --- | --- |\n| status | ready |\n- command: alpha | beta | gamma', base);
    expect(html).toContain("</table>");
    expect(html).toMatch(/<li[^>]*>command: alpha \| beta \| gamma<\/li>/);
  });

  it("keeps a literal escaped pipe at the end of a table row", () => {
    expect(render('a | b\n--- | ---\none | ends\\|', base)).toContain("ends|");
  });

  it("preserves parentheses and optional link titles", () => {
    const html = render('[docs](https://example.test/a(b) "Documentation")', base);
    expect(html).toMatch(/href="https:\/\/example.test\/a(?:\(b\)|%28b%29)"/);
    expect(html).toContain('title="Documentation"');
  });

  it("keeps emphasis around inline code and semantic nested lists", () => {
    const html = render('*Use `value` here*\n\n1. Parent\n   - Child\n     continuation\n2. Next', base);
    expect(html).toContain("<em>Use <code>value</code> here</em>");
    expect(html).toMatch(/<ol[^>]*><li[^>]*>Parent\s*<ul[^>]*><li[^>]*>Child/);
    expect(html).toContain("continuation");
  });

  it("keeps task state accessible and does not create a writable checkbox", () => {
    const html = render('- [x] Finished\n- [ ] Pending', base);
    expect(html).toContain('aria-label="Completed"');
    expect(html).toContain('aria-label="Not completed"');
    expect(html).not.toContain("<input");
  });

  it("does not load remote images or activate unsafe protocols", () => {
    const html = render('[Bad](javascript:alert(1))\n\n![Diagram](https://example.test/image.png)', base);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).toContain("Diagram");
  });

  it("renders partial fences as code and preserves text when the fence closes", () => {
    for (const suffix of ["", "\n```", "\n```\n\nDone."]) {
      const html = render('```ts\nconst value = 1;' + suffix, base);
      expect(html.match(/class="msg-code-wrap"/g)).toHaveLength(1);
      expect(html).toContain("value");
      expect(html).not.toContain("```ts");
    }
  });

  it("does not open disclosures from quoted code or HTML code examples", () => {
    const html = render('> ```html\n> <details><summary>Example</summary>Text</details>\n> ```', base);
    expect(html).not.toContain('<details');
    expect(html).toContain('class="msg-code-wrap"');
  });

  it("keeps fences literal inside presentation HTML", () => {
    const html = render('<div>\n```html\n<a href="/example">Example</a>\n<!-- literal -->\n```\n</div>', base);
    expect(html).toContain('class="msg-code-wrap"');
    expect(html).toContain('literal');
    expect(html).not.toContain('<a href="/example">');
  });

  it("does not rewrite Markdown link destinations inside presentation HTML", () => {
    const html = render('<div>\n[docs](https://example.test/a(b) "Documentation")\n</div>', base);
    expect(html).toContain('href="https://example.test/a(b)"');
    expect(html).toContain('title="Documentation"');
  });
});

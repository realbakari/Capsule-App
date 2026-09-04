import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "../features/conversation/MessageBody";
import { githubMarkdownHref, normalizeGitHubMarkdown } from "./github-markdown";
import { splitGitHubDetails } from "./github-details";

const base = "https://github.com/example/repo/pull/42";
const badge = '<!-- BOT_REVIEW -->A reviewer found one issue.\n\n<a href="https://example.com/review?link=long-payload&amp;source=bot"><picture><source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.png"><img alt="Open review" src="https://example.com/badge.png" width="115"></picture></a>\n<sup>Read the [review settings](https://example.com/settings).</sup><!-- bot-meta: {"kind":"review"} -->';

describe("host review Markdown", () => {
  it("turns an HTML image badge into a compact labelled link", () => {
    const text = normalizeGitHubMarkdown(badge, base);
    expect(text).toContain("[Open review](https://example.com/review?link=long-payload&source=bot)");
    expect(text).toContain("[review settings](https://example.com/settings)");
    expect(text).not.toMatch(/BOT_REVIEW|bot-meta|<picture|<source|<sup|<img|<a /);
  });

  it("does not produce executable links, markup, or remote image loads", () => {
    const text = normalizeGitHubMarkdown('<script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a> [Bad](data:text/html,bad) <img src="https://example.com/tracker.png" alt="Diagram" onerror="alert(1)">', base);
    expect(text).not.toMatch(/javascript:|data:text\/html|script|onerror|alert/);
    expect(text).toContain("[Diagram](https://example.com/tracker.png)");
    expect(githubMarkdownHref("&#106;avascript:alert(1)", base)).toBeUndefined();
  });

  it("preserves inline code and normal prose containing angle brackets", () => {
    expect(normalizeGitHubMarkdown('Use `<Widget />` and `<!-- example -->`; 2 < 3.', base)).toBe('Use `<Widget />` and `<!-- example -->`; 2 < 3.');
  });

  it("resolves relative web links and encodes parentheses for the inline parser", () => {
    expect(githubMarkdownHref("/example/repo/issues/2", base)).toBe("https://github.com/example/repo/issues/2");
    expect(githubMarkdownHref("https://example.com/a(b)", base)).toBe("https://example.com/a%28b%29");
  });

  it("renders review bodies with headings and links, not escaped HTML dumps", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content: `#### Review\n\n**Verdict:** Needs work\n\n${badge}`, githubBaseUrl: base }));
    expect(html).toContain('class="md-h">Review');
    expect(html).toContain("<strong>Verdict:</strong>");
    expect(html).toContain(">Open review</a>");
    expect(html).not.toContain("&lt;a");
    expect(html).not.toContain("bot-meta");
    expect(html).not.toContain("<img");
  });

  it("keeps fenced HTML examples literal while hiding prose metadata", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content: '<!-- prose-metadata -->\n```html\n<a href="/example">sample</a>\n<!-- literal -->\n```', githubBaseUrl: base }));
    expect(html).not.toContain("prose-metadata");
    expect(html).toContain("&lt;a");
    expect(html).toContain("literal");
  });

  it("renders expandable sections with Markdown tables, nested details and fenced code", () => {
    const content = 'Intro\n<details onclick="bad()"><summary>Measurements</summary>\n\n| Metric | Value |\n| --- | ---: |\n| Size | **12 KB** |\n\n<details open><summary>Method</summary>\n```ts\nconst count = 1;\n```\n</details>\n</details>\nOutro';
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content, githubBaseUrl: base }));
    expect(html).toContain('<details class="md-details"><summary>Measurements</summary>');
    expect(html).toContain('<details class="md-details" open=""><summary>Method</summary>');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<strong>12 KB</strong>');
    expect(html).toContain('class="tok-kw">const</span>');
    expect(html).not.toMatch(/onclick|bad\(\)|&lt;details/);
    expect(html).toContain("Outro");
  });

  it("does not interpret example or commented disclosure tags as panels", () => {
    const content = '<!-- <details>private-metadata</details> -->\nUse `<details>example</details>`.\n````html\n```\n<details>example</details>\n```\n````';
    expect(splitGitHubDetails(content)).toEqual([{ kind: "markdown", text: content }]);
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content, githubBaseUrl: base }));
    expect(html).not.toContain('<details');
    expect(html).not.toContain("private-metadata");
    expect(html).toContain("&lt;details&gt;");
  });

  it("keeps unclosed disclosure contents readable and ignores hostile summary attributes", () => {
    expect(splitGitHubDetails('<details><summary>Title</summary>Body')).toEqual([{ kind: "markdown", text: '<details><summary>Title</summary>Body' }]);
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content: '<details ontoggle="bad()"><summary><a href="javascript:alert(1)">Unsafe</a></summary>Text</details>', githubBaseUrl: base }));
    expect(html).toContain('<summary>Unsafe</summary>');
    expect(html).not.toMatch(/javascript|ontoggle|alert\(/);
  });
});

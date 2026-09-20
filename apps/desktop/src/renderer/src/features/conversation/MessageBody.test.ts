import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MessageBody";

describe("chat markdown", () => {
  it("keeps long unmatched markers literal and renders many emphasis spans without recursive tails", () => {
    const unmatched = "_identifier ".repeat(8000);
    const html = renderToStaticMarkup(createElement(MarkdownBody, { content: unmatched }));
    expect(html).toContain(unmatched.trim());
    expect(html).not.toContain("<em>");
    const matched = renderToStaticMarkup(createElement(MarkdownBody, { content: "*word* ".repeat(8000) }));
    expect(matched.match(/<em>/g)).toHaveLength(8000);
  });
  it("lets a link own activation even when its label is a file path", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "[`src/main.ts`](https://example.test/source)", onOpenFile() {},
    }));
    expect(html).toContain('<a href="https://example.test/source">');
    expect(html).toContain('class="file-chip"');
    expect(html).not.toContain('role="button"');
  });
  it("turns a file path in backticks into a labelled chip", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "See `github-stacks.ts` and `docs/user/projects-and-previews.md`.",
      onOpenFile() {},
    }));
    expect(html).toContain('class="file-chip file-mention"');
    expect(html).toContain(">TS</span>");
    expect(html).toContain("github-stacks.ts");
    expect(html).toContain(">MD</span>");
    expect(html).toContain("projects-and-previews.md");
  });

  it("keeps ordinary inline code, italics, and a bold-only line as a heading", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "**What you get**\n\nA `3/16` badge and *optional* ~~old~~ text.",
    }));
    expect(html).toContain('class="md-h">What you get</h4>');
    expect(html).toContain("<code>3/16</code>");
    expect(html).not.toContain("file-chip");
    expect(html).toContain("<em>optional</em>");
    expect(html).toContain("<s>old</s>");
  });

  it("does not italicize snake_case identifiers or spaced asterisks", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "some_variable_name and 2 * 3 * 4 and _italic_ here.",
    }));
    expect(html).toContain("some_variable_name");
    expect(html).not.toContain("<em>variable</em>");
    expect(html).toContain("2 * 3 * 4");
    expect(html).not.toContain("<em> 3 </em>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders numbered lists with a hanging number, not a run-on line", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "1. First item\n2. Second item with `github-stacks.ts`\n3. Third",
    }));
    expect(html).toContain('<ol class="md-list" start="1">');
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("First item");
    expect(html).toContain("Third");
  });

  it("renders task lists without treating the box as prose", () => {
    const html = renderToStaticMarkup(createElement(MarkdownBody, {
      content: "- [x] Done item\n- [ ] Open item",
    }));
    expect(html).toContain('class="md-task is-done"');
    expect(html).toContain('class="md-task"');
    expect(html).toContain("Done item");
    expect(html).toContain("Open item");
    expect(html).not.toContain("[x]");
    expect(html).not.toContain("[ ]");
  });
});

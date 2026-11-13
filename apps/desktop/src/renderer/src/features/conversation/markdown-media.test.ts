import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { htmlPreviewDocument, markdownImageSource, svgImageUrl } from "../../lib/markdown-media";
import { renderTex } from "./katex-runtime";
import { MarkdownBody } from "./MessageBody";

type Props = Parameters<typeof MarkdownBody>[0];
const render = (content: string, props: Partial<Props> = {}) => renderToStaticMarkup(createElement(MarkdownBody, { content, ...props }));
const pngData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("diagrams", () => {
  it("shows a mermaid block as its source until it is drawn", () => {
    for (const text of ["```mermaid\ngraph TD\nA-->B\n```", "```mermaid\ngraph TD\nA-->"]) {
      const html = render(text);
      expect(html).toContain('class="msg-code-wrap"');
      expect(html).toContain("mermaid");
      expect(html).toContain("A--&gt;");
    }
  });
});

describe("math", () => {
  it("renders formulas through the math view and leaves prices as prose", () => {
    const html = render("Energy $E=mc^2$ costs $5 and $10.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\na^2+b^2=c^2\n```");
    expect(html).toContain('class="md-math-source">$E=mc^2$</span>');
    expect(html).toContain("costs $5 and $10.");
    expect(html).toContain('md-math-source--block');
    expect(html).toContain("a^2+b^2=c^2");
    expect(html).not.toContain('class="msg-code-wrap"');
  });

  it("keeps shell variables in code untouched", () => {
    const html = render("Run `echo $HOME$PATH` and:\n\n```bash\nexport A=$B$C\n```");
    expect(html).not.toContain("md-math");
    expect(html).toContain("echo $HOME$PATH");
  });

  it("shows an unclosed math fence as code while it streams", () => {
    expect(render("```math\na^2")).toContain('class="msg-code-wrap"');
  });

  it("typesets TeX without trusting commands that link or embed", () => {
    expect(renderTex("x^2", false)).toContain('class="katex"');
    expect(renderTex("\\sum_i i", true)).toContain("katex-display");
    expect(() => renderTex("\\frac{", false)).toThrow();
    expect(renderTex("\\href{javascript:alert(1)}{x}", false)).not.toMatch(/<a\b|href=/);
  });
});

describe("images", () => {
  it("classifies where an image may load from", () => {
    expect(markdownImageSource("./shots/home.png")).toEqual({ kind: "local", path: "./shots/home.png" });
    expect(markdownImageSource("/work/app/shot.webp")).toEqual({ kind: "local", path: "/work/app/shot.webp" });
    expect(markdownImageSource("https://example.test/a.png")).toEqual({ kind: "remote", url: "https://example.test/a.png" });
    expect(markdownImageSource(pngData)).toEqual({ kind: "data", url: pngData });
    expect(markdownImageSource("data:image/svg+xml;base64,PHN2Zz4=").kind).toBe("none");
    expect(markdownImageSource("./notes.txt").kind).toBe("none");
    expect(markdownImageSource("javascript:alert(1)").kind).toBe("none");
  });

  it("never loads a web image, and offers to open it instead", () => {
    const html = render("![Chart](https://example.test/chart.png)", { onOpenLink: () => undefined });
    expect(html).not.toContain("<img");
    expect(html).toContain("Chart");
    expect(html).toContain("example.test/chart.png");
    expect(html).toContain(">Open</button>");
  });

  it("reads a project image only through the loader, never as a file URL", () => {
    const loading = render("![Home](./shots/home.png)", { loadImage: () => new Promise(() => undefined) });
    expect(loading).toContain("Loading image…");
    expect(loading).not.toContain("<img");
    expect(loading).not.toContain("file:");
    const linked = render("![Home](file:///work/shots/home.png)", { onOpenFile: () => undefined });
    expect(linked).toContain('class="md-file-link"');
    expect(linked).not.toContain("<img");
  });

  it("shows inline data images as zoomable images", () => {
    const html = render(`![Dot](${pngData})`);
    expect(html).toContain('class="md-image"');
    expect(html).toContain(`src="${pngData}"`);
  });

  it("keeps a linked badge as its label", () => {
    const html = render("[![build passing](https://example.test/badge.svg)](https://example.test/ci)");
    expect(html).toContain("build passing");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<img");
  });

  it("sizes a drawn diagram for the zoom view", () => {
    const url = svgImageUrl('<svg id="d" width="100%" style="max-width: 300px;" viewBox="0 0 300 120"><g/></svg>');
    const svg = decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
    expect(svg).toMatch(/^<svg width="300" height="120" id="d" viewBox="0 0 300 120">/);
  });
});

describe("HTML preview", () => {
  it("offers a preview for HTML blocks only", () => {
    expect(render("```html\n<p>Hi</p>\n```")).toContain(">Preview</button>");
    expect(render("```js\nalert(1)\n```")).not.toContain(">Preview</button>");
  });

  it("fences the previewed page off the network before any of its markup", () => {
    const page = htmlPreviewDocument('<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><script>fetch("http://127.0.0.1")</script></body></html>', false);
    expect(page.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    expect(page).toContain("script-src 'none'");
    expect(page.match(/<!doctype/gi)).toHaveLength(1);
    expect(htmlPreviewDocument("<p>x</p>", true)).toContain("script-src 'unsafe-inline'");
    expect(htmlPreviewDocument("<p>x</p>", true)).not.toContain("connect-src");
  });
});

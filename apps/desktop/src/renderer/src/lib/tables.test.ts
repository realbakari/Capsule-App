import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "../features/conversation/MarkdownBody";

const render = (content: string) => renderToStaticMarkup(createElement(MarkdownBody, { content }));

describe("rendered Markdown tables", () => {
  it("reads a table with outer pipes", () => {
    const html = render('| Path | Description |\n| --- | --- |\n| src/ | Source |');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th>Path</th>');
    expect(html).toContain('<td>src/</td><td>Source</td>');
  });

  it("reads a table without outer pipes", () => {
    expect(render('Path | Description\n--- | ---\nsrc/ | Source')).toContain('<td>src/</td><td>Source</td>');
  });

  it("preserves column alignment", () => {
    const html = render('| Left | Center | Right |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    for (const alignment of ['left', 'center', 'right']) expect(html).toContain(`style="text-align:${alignment}"`);
  });

  it("leaves prose pipes alone", () => {
    expect(render('Run alpha | beta\nthen continue')).not.toContain('<table');
  });

  it("requires matching header and delimiter counts", () => {
    expect(render('| a | b |\n| --- |\n| 1 | 2 |')).not.toContain('<table');
  });

  it("preserves escaped pipes in the middle and at the end of cells", () => {
    const html = render('Command | Note\n--- | ---\na \\| b | ends\\|');
    expect(html).toContain('<td>a | b</td><td>ends|</td>');
  });

  it("pads short rows", () => {
    expect(render('| a | b | c |\n| --- | --- | --- |\n| 1 |')).toContain('<td>1</td><td></td><td></td>');
  });

  it("ignores extra cells only within a table row", () => {
    expect(render('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |')).toContain('<td>1</td><td>2</td></tr>');
  });

  it("stops at blank lines and block interruptions", () => {
    for (const following of ['\nAfter', '- After | more | text', '> After | more | text']) {
      const html = render('| a | b |\n| --- | --- |\n| 1 | 2 |\n' + following);
      expect(html.indexOf('After')).toBeGreaterThan(html.indexOf('</table>'));
    }
  });

  it("renders a header-only table", () => {
    const html = render('| a | b |\n| --- | --- |');
    expect(html).toContain('<th>a</th>');
    expect(html).not.toContain('<td>');
  });

  it("finds a table after introductory prose", () => {
    expect(render('Intro\n\n| a |\n| --- |\n| 1 |')).toContain('<td>1</td>');
  });
});

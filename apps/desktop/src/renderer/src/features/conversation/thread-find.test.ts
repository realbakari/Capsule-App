import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import { turnsFromMessages } from "../../lib/turns";
import { MarkdownBody } from "./MarkdownBody";
import { alignSegments, collectTextSegments, findInTurns, findOccurrences, matchBounds, searchableSegments, type FindNode } from "./thread-find";

/* Just enough HTML parsing to read React's static markup back as nodes. */
const VOID = new Set(["br", "hr", "img", "input", "wbr", "source", "col", "area"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#x27": "'", "#39": "'", nbsp: " " };
interface TestNode extends FindNode { childNodes: TestNode[] }
function parseHtml(html: string): TestNode {
  const root: TestNode = { nodeType: 1, nodeValue: null, tagName: "ROOT", childNodes: [] };
  const stack = [root];
  for (const [part, closing, tag, attributes] of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+/g)) {
    const parent = stack.at(-1)!;
    if (part.startsWith("<!--")) continue;
    if (!tag) {
      parent.childNodes.push({ nodeType: 3, nodeValue: part.replace(/&(#x27|#39|amp|lt|gt|quot|nbsp);/g, (_, name: string) => ENTITIES[name]!), childNodes: [] });
      continue;
    }
    if (closing) { stack.pop(); continue; }
    const attrs = new Map(Array.from(attributes!.matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name!, value!]));
    const element: TestNode = {
      nodeType: 1, nodeValue: null, tagName: tag.toUpperCase(), childNodes: [],
      getAttribute: (name) => attrs.get(name) ?? null,
      classList: { contains: (name) => (attrs.get("class") ?? "").split(/\s+/).includes(name) },
    };
    parent.childNodes.push(element);
    if (!VOID.has(tag.toLowerCase()) && !attributes!.trimEnd().endsWith("/")) stack.push(element);
  }
  return root.childNodes[0]!;
}

const mounted = (content: string) => collectTextSegments(parseHtml(renderToStaticMarkup(createElement(MarkdownBody, { content, onOpenFile: () => {}, onOpenLink: () => {} }))));

const REPLIES = [
  "Plain text on\none paragraph with a soft break.",
  "Some **bold**, _emphasis_, ~~struck~~ and `inline code`.",
  "Open `src/app.ts:12` and `README.md`, not `fix/login` or `Node.js`.",
  "A [link with **bold**](https://example.com/docs) and a bare https://example.com/x link.",
  "```ts\nconst answer: number = 42;\nfunction twice(value) { return value * 2; }\n```\n\nAfter the fence.",
  "- first item\n- second item with `code`\n  - nested item\n\n1. ordered\n2. list",
  "- [ ] open task\n- [x] done task",
  "> [!WARNING]\n> Mind the gap.\n\n> A plain quote\n> across lines.",
  "| Field | Value |\n| --- | :---: |\n| status | ready |\n| count | 3 |",
  "# Heading one\n\n### Heading three\n\nBody text.\n\n---\n\nAfter the rule.",
  "Line one  \nLine two after a hard break.",
  "Press <kbd>Ctrl</kbd>+<kbd>C</kbd>.<br>Then <b>stop</b>.",
  "<details><summary>More</summary>\n\nHidden **detail** text.\n\n</details>",
  "Inline math $a^2 + b^2$ stays out. Then:\n\n$$\nE = mc^2\n$$\n\nAfter math.",
  "An image ![diagram](https://example.com/d.png) and a badge [![build](https://example.com/b.svg)](https://example.com).",
  "Windows line\r\nendings\r\nhere.",
  "**Bold-only heading**\n\nText under it.",
  "Ünïcödé — “quotes” & <ampersands> 😀 emoji.",
];

describe("find in a conversation", () => {
  it.each(REPLIES)("searches the same blocks the reply shows: %j", (content) => {
    expect(mounted(content).map((segment) => segment.text)).toEqual(searchableSegments(content));
  });

  it("searches rendered text, not Markdown syntax", () => {
    const segments = searchableSegments("Use **the `config.json`** file, [docs](https://example.com).");
    expect(segments.join("\n")).toBe("Use the config.json file, docs.");
    expect(findOccurrences(segments[0]!, "**")).toEqual([]);
    expect(findOccurrences(segments[0]!, "https")).toEqual([]);
  });

  it("finds every occurrence, ignoring case and treating the query literally", () => {
    expect(findOccurrences("Cat, cat and CAT.", "cat")).toEqual([{ start: 0, end: 3 }, { start: 5, end: 8 }, { start: 13, end: 16 }]);
    expect(findOccurrences("a.b and axb", "a.b")).toEqual([{ start: 0, end: 3 }]);
    expect(findOccurrences("(x) [y]", "[y]")).toEqual([{ start: 4, end: 7 }]);
    expect(findOccurrences("ÉCOLE école", "école")).toHaveLength(2);
    expect(findOccurrences("anything", "   ")).toEqual([]);
  });

  it("counts each occurrence across the thread in reading order, and skips a compaction turn", () => {
    const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, sessionId: "s", role, content, createdAt: `2026-01-01T00:00:0${id.length}Z` });
    const turns = turnsFromMessages([
      message("p1", "user", "Fix the parser"),
      message("r1", "assistant", "The parser was wrong.\n\nParser fixed; parser tests pass."),
      message("p2", "user", "/compact parser notes"),
      message("r2", "assistant", "Summary mentioning the parser."),
      message("p3", "user", "Thanks"),
    ]);
    const matches = findInTurns(turns, "parser");
    expect(matches.map((match) => `${match.messageId}:${match.segment}:${match.start}`)).toEqual(["p1:0:8", "r1:0:4", "r1:1:0", "r1:1:14"]);
  });

  it("highlights a match that spans formatting inside one block", () => {
    const segments = mounted("A **bold** move");
    const [range] = findOccurrences(segments[0]!.text, "bold mo").map(({ start, end }) => matchBounds(segments[0]!, start, end));
    expect(range?.startNode.nodeValue).toBe("bold");
    expect(range?.startOffset).toBe(0);
    expect(range?.endNode.nodeValue).toBe(" move");
    expect(range?.endOffset).toBe(3);
  });

  it("leaves a block the page does not show as text unpaired, without shifting later blocks", () => {
    const searched = ["first", "diagram source", "last"];
    const shown = [{ text: "first", nodes: [] }, { text: "last", nodes: [] }];
    expect(alignSegments(searched, shown).map((segment) => segment?.text)).toEqual(["first", undefined, "last"]);
  });
});

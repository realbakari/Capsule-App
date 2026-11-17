import type { ChatMessage } from "@capsule/shared";
import { parseMarkdown } from "../../lib/markdown";
import { normalizeGitHubMarkdown } from "../../lib/github-markdown";
import { splitFences } from "../../lib/fences";
import { fenceClosed } from "../../lib/markdown-math";
import { markdownImageSource } from "../../lib/markdown-media";
import type { Turn } from "../../lib/turns";
import { isCompactionTurn } from "./CompactionDivider";
import { readFileRef } from "./InlineCode";
import { ALERT_MARKER, ALERT_PREFIX, TASK_MARKER, firstInline, markdownRuns, tokenTree, withoutPrefix, type MarkdownNode } from "./MarkdownBody";

/*
 * Find in a conversation searches what a reply shows, not its Markdown. Each
 * message becomes the text of its blocks (paragraphs, list items, cells, code
 * blocks), in order. A match never spans two blocks, as on a web page.
 *
 * Two readers produce those blocks. `searchableSegments` walks the parser's
 * tokens the way MarkdownBody renders them, so messages that are not on
 * screen (virtualized, folded) still count. `collectTextSegments` reads the
 * mounted DOM, so a match can be highlighted. A parity test renders the same
 * Markdown both ways and keeps them equal.
 */

/** One occurrence of the query, located in a message's rendered blocks. */
export interface FindMatch {
  turnId: string;
  messageId: string;
  /** Which block of the message's searchable text. */
  segment: number;
  start: number;
  end: number;
}

class Segments {
  readonly list: string[] = [];
  private text = "";
  /* Line breaks read as spaces outside code, one for one, so offsets stay put. */
  add(value: string) { this.text += value.replace(/[\r\n]/g, " "); }
  addPre(value: string) { this.text += value; }
  flush() {
    if (this.text.trim()) this.list.push(this.text);
    this.text = "";
  }
}

function writeFence(out: Segments, code: string, language: string | undefined, closed: boolean) {
  out.flush();
  // A closed math fence is typeset; any other fence shows its source, a diagram until it is drawn.
  if (!(language?.toLowerCase() === "math" && closed && code.trim())) out.addPre(code);
  out.flush();
}

function writeParsed(out: Segments, text: string, inline: boolean, allowHtml: boolean, inLink: boolean) {
  const parsed = parseMarkdown(text, inline, allowHtml);
  if (parsed.literal !== undefined) out.add(parsed.literal);
  else writeNodes(out, tokenTree(parsed.tokens), inLink);
}

function writeHtml(out: Segments, raw: string, inline: boolean, inLink: boolean) {
  for (const segment of splitFences(raw)) {
    if (segment.kind === "code") { writeFence(out, segment.text, segment.language, segment.closed !== false); continue; }
    const text = normalizeGitHubMarkdown(segment.text, "");
    if (text) writeParsed(out, text, inline, false, inLink);
  }
}

function writeNodes(out: Segments, nodes: MarkdownNode[], inLink: boolean) {
  for (const { node, html } of markdownRuns(nodes)) {
    if (html !== undefined) writeHtml(out, html, true, inLink);
    else writeNode(out, node, inLink);
  }
}

function writeBlock(out: Segments, nodes: MarkdownNode[], inLink: boolean) {
  out.flush();
  writeNodes(out, nodes, inLink);
  out.flush();
}

function writeNode(out: Segments, node: MarkdownNode, inLink: boolean): void {
  const { token, children } = node;
  switch (token.type) {
    case "text": out.add(node.text ?? token.content); return;
    case "inline": case "strong_open": case "em_open": case "s_open": writeNodes(out, children, inLink); return;
    case "softbreak": out.add("\n"); return;
    case "hardbreak": out.flush(); return;
    case "code_inline": {
      const ref = readFileRef(token.content);
      out.add(ref ? `${ref.name}${ref.line ? `:${ref.line}` : ""}` : token.content);
      return;
    }
    case "fence": writeFence(out, token.content, token.info.trim().split(/\s+/)[0], fenceClosed(token.meta)); return;
    case "code_block": writeFence(out, token.content, undefined, true); return;
    case "math_inline": return;
    case "math_block": out.flush(); return;
    case "link_open": writeNodes(out, children, true); return;
    case "image": {
      const kind = markdownImageSource(String(token.attrGet("src") ?? "")).kind;
      // A badge inside a link keeps its label; any other image is a picture or a card, not text.
      if (kind === "none" || (inLink && kind !== "data")) out.add(token.content || "Image");
      return;
    }
    case "html_inline":
      if (/^<br\b/i.test(token.content)) out.flush();
      else writeHtml(out, token.content, true, inLink);
      return;
    case "html_block": writeHtml(out, token.content, false, inLink); return;
    case "paragraph_open":
      if (token.hidden) writeNodes(out, children, inLink);
      else writeBlock(out, children, inLink);
      return;
    case "blockquote_open": {
      const marker = ALERT_MARKER.exec(firstInline(node)?.token.content ?? "");
      if (!marker) { writeBlock(out, children, inLink); return; }
      const kind = marker[1]!.toLowerCase();
      out.flush();
      out.add(kind[0]!.toUpperCase() + kind.slice(1));
      writeBlock(out, withoutPrefix(node, ALERT_PREFIX).children, inLink);
      return;
    }
    case "list_item_open": {
      const task = TASK_MARKER.test(firstInline(node)?.token.content ?? "");
      writeBlock(out, task ? withoutPrefix(node, TASK_MARKER).children : children, inLink);
      return;
    }
    case "heading_open": case "bullet_list_open": case "ordered_list_open": case "table_open":
    case "thead_open": case "tbody_open": case "tr_open": case "th_open": case "td_open":
      writeBlock(out, children, inLink);
      return;
    case "hr": out.flush(); return;
    default:
      if (token.content) out.add(token.content);
      else writeNodes(out, children, inLink);
  }
}

/** A message's rendered text, block by block. */
export function searchableSegments(content: string): string[] {
  const out = new Segments();
  writeParsed(out, content, false, true, false);
  out.flush();
  return out.list;
}

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/** Where the query occurs in a block of text, ignoring case. */
export function findOccurrences(text: string, query: string): Array<{ start: number; end: number }> {
  if (!query.trim()) return [];
  const pattern = new RegExp(query.replace(SYNTAX, "\\$&"), "giu");
  return Array.from(text.matchAll(pattern), (match) => ({ start: match.index, end: match.index + match[0].length }));
}

/* Messages are immutable: a streamed frame replaces the object, so its text is read again. */
const segmentCache = new WeakMap<ChatMessage, string[]>();
export function messageSegments(message: ChatMessage): string[] {
  let segments = segmentCache.get(message);
  if (!segments) {
    segments = searchableSegments(message.content);
    segmentCache.set(message, segments);
  }
  return segments;
}

/** Every occurrence in the conversation, in reading order. A compaction turn shows no text, so it has none. */
export function findInTurns(turns: readonly Turn[], query: string): FindMatch[] {
  if (!query.trim()) return [];
  const matches: FindMatch[] = [];
  for (const turn of turns) {
    if (isCompactionTurn(turn.prompt)) continue;
    for (const message of turn.messages) {
      if (!message.content) continue;
      messageSegments(message).forEach((text, segment) => {
        for (const { start, end } of findOccurrences(text, query)) matches.push({ turnId: turn.id, messageId: message.id, segment, start, end });
      });
    }
  }
  return matches;
}

/* ----- The mounted DOM ----- */

/** The parts of the DOM the collector reads; a real Node satisfies it. */
export interface FindNode {
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<FindNode>;
  tagName?: string;
  getAttribute?(name: string): string | null;
  classList?: { contains(name: string): boolean };
}

export interface DomSegment {
  text: string;
  /** Text nodes in order, with where each one starts and ends in `text`. */
  nodes: Array<{ node: FindNode; start: number; end: number }>;
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "summary", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);

/* Chrome around a reply's text that the search above never sees: code bar, task mark, pictures, typeset math. */
const IGNORED_CLASSES = ["msg-code-bar", "md-task-mark", "md-math", "md-math-source", "md-image", "md-image-card", "md-diagram"];

function ignored(element: FindNode, tag: string): boolean {
  return tag === "svg" || tag === "img" || element.getAttribute?.("aria-hidden") === "true"
    || IGNORED_CLASSES.some((name) => element.classList?.contains(name));
}

/** The rendered blocks of one message body, with the text nodes that make each one. */
export function collectTextSegments(root: FindNode): DomSegment[] {
  const segments: DomSegment[] = [];
  let current: DomSegment = { text: "", nodes: [] };
  const flush = () => {
    if (current.text.trim()) segments.push(current);
    current = { text: "", nodes: [] };
  };
  const visit = (node: FindNode, inPre: boolean) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? "";
      const start = current.text.length;
      current.text += inPre ? value : value.replace(/[\r\n]/g, " ");
      current.nodes.push({ node, start, end: current.text.length });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName?.toLowerCase() ?? "";
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    if (ignored(node, tag)) return;
    for (let index = 0; index < node.childNodes.length; index++) visit(node.childNodes[index]!, inPre || tag === "pre");
    if (block) flush();
  };
  for (let index = 0; index < root.childNodes.length; index++) visit(root.childNodes[index]!, false);
  flush();
  return segments;
}

/**
 * Pair each searched block with the mounted block that shows the same text.
 * Blocks are matched in order by their text, so a block the DOM does not show
 * as text (a drawn diagram) leaves that block unpaired instead of shifting
 * every highlight after it.
 */
export function alignSegments(searched: readonly string[], mounted: readonly DomSegment[]): Array<DomSegment | undefined> {
  const paired: Array<DomSegment | undefined> = [];
  let next = 0;
  for (const text of searched) {
    let index = next;
    while (index < mounted.length && mounted[index]!.text !== text) index++;
    if (index < mounted.length) { paired.push(mounted[index]); next = index + 1; }
    else paired.push(undefined);
  }
  return paired;
}

/** The text nodes and offsets that bound one match inside a mounted block. */
export function matchBounds(segment: DomSegment, start: number, end: number) {
  const first = segment.nodes.find((item) => item.end > start);
  const last = segment.nodes.find((item) => item.end >= end);
  if (!first || !last) return undefined;
  return { startNode: first.node, startOffset: start - first.start, endNode: last.node, endOffset: end - last.start };
}


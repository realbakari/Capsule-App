import { Fragment, createElement, useMemo, type ReactNode } from "react";
import type { Token } from "markdown-it";
import { parseMarkdown, markdownHref, markdownFilePath } from "../../lib/markdown";
import { normalizeGitHubMarkdown } from "../../lib/github-markdown";
import { splitGitHubDetails } from "../../lib/github-details";
import { splitFences } from "../../lib/fences";
import { fenceClosed } from "../../lib/markdown-math";
import { FencedCode } from "./FencedCode";
import { InlineCode } from "./InlineCode";
import { MarkdownImage, type LoadImage } from "./MarkdownImage";
import { MathTex } from "./MathTex";
import { openInSystemBrowser } from "./link-actions";

interface MarkdownActions {
  githubBaseUrl?: string;
  onOpenFile?: (path: string) => void;
  onOpenLink?: (href: string) => void;
  /** A web link's context menu, at the pointer. */
  onLinkMenu?: (href: string, point: { x: number; y: number }) => void;
  renderText?: (text: string) => ReactNode;
  /** Reads a project image; without it a local image stays a file link. */
  loadImage?: LoadImage;
  inLink?: boolean;
}

export interface MarkdownNode {
  token: Token;
  children: MarkdownNode[];
  text?: string;
}

/** Pair parser tokens once, without rescanning the rest of a list or quote. */
export function tokenTree(tokens: Token[]): MarkdownNode[] {
  const roots: MarkdownNode[] = [];
  const stack = [roots];
  for (const token of tokens) {
    if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
    const node = { token, children: token.children ? tokenTree(token.children) : [] };
    stack[stack.length - 1]!.push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return roots;
}

function WebLink({ href, title, children, actions }: {
  href: string; title?: string; children: ReactNode; actions: MarkdownActions;
}) {
  const safeHref = markdownHref(href, actions.githubBaseUrl);
  if (!safeHref) {
    const path = markdownFilePath(href, actions.githubBaseUrl);
    return path && actions.onOpenFile
      ? <button type="button" className="md-file-link" title={path} onClick={() => actions.onOpenFile?.(path)}>{children}</button>
      : <>{children}</>;
  }
  const { onOpenLink, onLinkMenu } = actions;
  return <a href={safeHref} title={title}
    onClick={(event) => {
      event.preventDefault();
      // Option-click skips the browser panel for the system browser.
      if (onOpenLink && !event.altKey) onOpenLink(safeHref);
      else openInSystemBrowser(safeHref);
    }}
    onContextMenu={onLinkMenu && ((event) => {
      event.preventDefault();
      onLinkMenu(safeHref, { x: event.clientX, y: event.clientY });
    })}>{children}</a>;
}

function parsedContent(text: string, actions: MarkdownActions, inline = false, allowHtml = true): ReactNode {
  const parsed = parseMarkdown(text, inline, allowHtml);
  return parsed.literal !== undefined
    ? <span className="md-literal">{parsed.literal}</span>
    : renderNodes(tokenTree(parsed.tokens), actions);
}

/** Convert presentation HTML only. Markdown links and code never pass through it. */
function presentationHtml(raw: string, actions: MarkdownActions, inline: boolean): ReactNode {
  return splitFences(raw).map((segment, index) => {
    if (segment.kind === "code") return <FencedCode key={index} code={segment.text} language={segment.language} closed={segment.closed !== false} />;
    const text = normalizeGitHubMarkdown(segment.text, actions.githubBaseUrl ?? "");
    return text ? <Fragment key={index}>{parsedContent(text, actions, inline, false)}</Fragment> : null;
  });
}

/**
 * Sibling nodes as they render: one node at a time, except that an HTML
 * anchor or unsafe container split into inline tokens comes back whole as
 * `html`, so a badge keeps its label and script text is discarded.
 */
export function* markdownRuns(nodes: MarkdownNode[]): Generator<{ index: number; node: MarkdownNode; html?: string }> {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const opening = node.token.type === "html_inline" && /^<(a|script|style|iframe|object)\b/i.exec(node.token.content);
    if (opening) {
      const closing = new RegExp(`^<\\/${opening[1]}\\s*>`, "i");
      let end = index + 1;
      // Malformed opening tags must not trigger repeated scans of a long reply.
      const limit = Math.min(nodes.length, index + 64);
      while (end < limit && !closing.test(nodes[end]!.token.content)) end++;
      if (end < limit) {
        yield { index, node, html: nodes.slice(index, end + 1).map((part) => part.token.content).join("") };
        index = end;
        continue;
      }
    }
    yield { index, node };
  }
}

function renderNodes(nodes: MarkdownNode[], actions: MarkdownActions): ReactNode[] {
  return Array.from(markdownRuns(nodes), ({ index, node, html }) => <Fragment key={index}>
    {html !== undefined ? presentationHtml(html, actions, true) : renderNode(node, actions)}
  </Fragment>);
}

export const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i;
export const ALERT_PREFIX = /^\[![A-Z]+\]/i;
export const TASK_MARKER = /^\[([ xX])\]\s+/;

export function firstInline(node: MarkdownNode): MarkdownNode | undefined {
  const paragraph = node.children[0];
  return paragraph?.token.type === "paragraph_open" ? paragraph.children[0] : undefined;
}

function attribute(token: Token, name: string): string | undefined {
  const value = token.attrGet(name);
  return value == null ? undefined : String(value);
}

/** Remove a task/alert prefix from a copy, preserving the parsed inline markup. */
export function withoutPrefix(node: MarkdownNode, prefix: RegExp): MarkdownNode {
  const children = [...node.children];
  const paragraph = children[0];
  const inline = firstInline(node);
  if (!paragraph || !inline) return node;
  const parts = [...inline.children];
  const first = parts[0];
  if (first?.token.type === "text") {
    parts[0] = { ...first, text: first.token.content.replace(prefix, "") };
    if (!parts[0]!.text) parts.shift();
    if (parts[0]?.token.type === "softbreak") parts.shift();
  }
  children[0] = { ...paragraph, children: [{ ...inline, children: parts }] };
  if (!parts.length) children.shift();
  return { ...node, children };
}

function renderNode(node: MarkdownNode, actions: MarkdownActions): ReactNode {
  const { token, children } = node;
  switch (token.type) {
    case "text": return actions.renderText ? actions.renderText(node.text ?? token.content) : node.text ?? token.content;
    case "inline": return renderNodes(children, actions);
    case "softbreak": return "\n";
    case "hardbreak": return <br />;
    case "code_inline": return <InlineCode value={token.content} onOpen={actions.onOpenFile} />;
    case "fence": return <FencedCode code={token.content} language={token.info.trim().split(/\s+/)[0]} closed={fenceClosed(token.meta)} />;
    case "code_block": return <FencedCode code={token.content} closed />;
    case "math_inline": return <MathTex tex={token.content} display={token.markup === "$$"} />;
    case "math_block": return <MathTex tex={token.content} display />;
    case "link_open": return <WebLink href={attribute(token, "href") ?? ""} title={attribute(token, "title")} actions={actions}>
      {renderNodes(children, { ...actions, onOpenFile: undefined, renderText: undefined, inLink: true })}
    </WebLink>;
    case "image": return <MarkdownImage src={attribute(token, "src") ?? ""} alt={token.content} title={attribute(token, "title")}
      baseUrl={actions.githubBaseUrl} inLink={actions.inLink} loadImage={actions.loadImage} onOpenFile={actions.onOpenFile} onOpenLink={actions.onOpenLink} />;
    case "html_inline":
      if (/^<br\b/i.test(token.content)) return <br />;
      return presentationHtml(token.content, actions, true);
    case "html_block": return presentationHtml(token.content, actions, false);
    case "paragraph_open": {
      if (token.hidden) return renderNodes(children, actions);
      const parts = (children[0]?.children ?? []).filter((part) => part.token.type !== "text" || part.token.content !== "");
      // Preserve Capsule's compact bold-only section headings.
      if (parts.length === 1 && parts[0]?.token.type === "strong_open") {
        return <h4 className="md-h md-h-bold">{renderNodes(parts[0].children, actions)}</h4>;
      }
      return <p className="md-p">{renderNodes(children, actions)}</p>;
    }
    case "heading_open": {
      // The conversation and author own h1/h2. Keep reply levels below them.
      const level = Math.min(6, Number(token.tag.slice(1)) + 2);
      return createElement(`h${level}`, { className: "md-h" }, renderNodes(children, actions));
    }
    case "blockquote_open": {
      const marker = ALERT_MARKER.exec(firstInline(node)?.token.content ?? "");
      if (!marker) return <blockquote className="md-quote">{renderNodes(children, actions)}</blockquote>;
      const kind = marker[1]!.toLowerCase();
      return <aside className={`md-alert md-alert--${kind}`}>
        <b className="md-alert-title">{kind[0]!.toUpperCase() + kind.slice(1)}</b>
        {renderNodes(withoutPrefix(node, ALERT_PREFIX).children, actions)}
      </aside>;
    }
    case "bullet_list_open": return <ul className="md-list">{renderNodes(children, actions)}</ul>;
    case "ordered_list_open": return <ol className="md-list" start={Number(token.attrGet("start") ?? 1)}>{renderNodes(children, actions)}</ol>;
    case "list_item_open": {
      const task = TASK_MARKER.exec(firstInline(node)?.token.content ?? "");
      if (!task) return <li>{renderNodes(children, actions)}</li>;
      const done = task[1] !== " ";
      return <li className={`md-task${done ? " is-done" : ""}`}>
        <span className="md-task-mark" role="img" aria-label={done ? "Completed" : "Not completed"}>{done ? "✓" : ""}</span>
        <div>{renderNodes(withoutPrefix(node, TASK_MARKER).children, actions)}</div>
      </li>;
    }
    case "table_open": return <div className="md-table-wrap" tabIndex={0} role="region" aria-label="Table">
      <table className="md-table">{renderNodes(children, actions)}</table>
    </div>;
    case "th_open":
    case "td_open": {
      const align = attribute(token, "style")?.match(/^text-align:(left|center|right)$/)?.[1] as "left" | "center" | "right" | undefined;
      return createElement(token.type === "th_open" ? "th" : "td", { style: align ? { textAlign: align } : undefined }, renderNodes(children, actions));
    }
    case "hr": return <hr className="md-hr" />;
    case "thead_open": case "tbody_open": case "tr_open":
    case "strong_open": case "em_open": case "s_open":
      return createElement(token.tag, null, renderNodes(children, actions));
    default: return token.content || renderNodes(children, actions);
  }
}

function markdownSections(content: string, actions: MarkdownActions, depth = 0): ReactNode {
  const sections = actions.githubBaseUrl && depth < 12
    ? splitGitHubDetails(content)
    : [{ kind: "markdown" as const, text: content }];
  return sections.map((section, index) => section.kind === "details" ? (
    <details className="md-details" open={section.open} key={index}>
      <summary>{parsedContent(section.summary, { ...actions, onOpenFile: undefined }, true)}</summary>
      <div className="md-details-body">{markdownSections(section.text, actions, depth + 1)}</div>
    </details>
  ) : <Fragment key={index}>{parsedContent(section.text, actions)}</Fragment>);
}

/** Safe React nodes shared by chat, review, skills and read-only paired views. */
export function MarkdownBody({ content, ...actions }: Omit<MarkdownActions, "inLink"> & { content: string }) {
  const { githubBaseUrl, onOpenFile, onOpenLink, onLinkMenu, renderText, loadImage } = actions;
  const body = useMemo(() => markdownSections(content, { githubBaseUrl, onOpenFile, onOpenLink, onLinkMenu, renderText, loadImage }), [content, githubBaseUrl, onOpenFile, onOpenLink, onLinkMenu, renderText, loadImage]);
  return <div className="body">{body}</div>;
}

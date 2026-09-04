import { codeFences } from "./fences";

export type GitHubBodySection =
  | { kind: "markdown"; text: string }
  | { kind: "details"; summary: string; text: string; open: boolean };

/**
 * Recognize only balanced disclosure boundaries, outside comments and code.
 * Attributes are never passed to the DOM. Everything inside is still Markdown,
 * handled by the same safe renderer as the surrounding body.
 */
export function splitGitHubDetails(content: string): GitHubBodySection[] {
  // Keep offsets stable while hiding code so example tags cannot open panels.
  let masked = "";
  let offset = 0;
  for (const fence of codeFences(content)) {
    masked += content.slice(offset, fence.start) + " ".repeat(fence.end - fence.start);
    offset = fence.end;
  }
  masked = (masked + content.slice(offset)).replace(
    /(`+)[^\n]*?\1|<!--[\s\S]*?(?:-->|$)/g,
    (text) => text.replace(/[^\n]/g, " "),
  );
  const result: GitHubBodySection[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  let consumed = 0;
  let open = false;
  for (const match of masked.matchAll(/<\/?details\b[^>]*>/gi)) {
    const closing = /^<\//.test(match[0]);
    if (!closing) {
      if (depth === 0) {
        start = match.index;
        bodyStart = start + match[0].length;
        open = /\sopen(?:\s|=|>)/i.test(match[0]);
      }
      depth += 1;
    } else if (depth > 0 && --depth === 0) {
      if (start > consumed) result.push({ kind: "markdown", text: content.slice(consumed, start) });
      const body = content.slice(bodyStart, match.index);
      const summary = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(body);
      result.push({ kind: "details", summary: summary?.[1] || "Details", text: summary ? body.slice(summary[0].length) : body, open });
      consumed = match.index + match[0].length;
    }
  }
  if (consumed < content.length) result.push({ kind: "markdown", text: content.slice(consumed) });
  return result;
}

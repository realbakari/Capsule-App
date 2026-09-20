import { parseMarkdown } from "./markdown";

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
  const lines = content.split("\n");
  // Parser source maps include quoted and list-contained fences, unlike a
  // top-level delimiter scan. Example disclosure tags must stay code there too.
  for (const token of parseMarkdown(content).tokens) {
    if ((token.type === "fence" || token.type === "code_block") && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) lines[line] = " ".repeat(lines[line]?.length ?? 0);
    }
  }
  const masked = lines.join("\n").replace(
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

import { stripHtmlComments } from "./markdown-html";

function entities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name: string) => {
    if (name[0] !== "#") return named[name.toLowerCase()] ?? match;
    const point = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function attribute(text: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(text);
  return entities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

/** PR content may link to web pages, not execute a protocol supplied by a bot. */
export function githubMarkdownHref(raw: string, baseUrl: string): string | undefined {
  if (!raw.trim()) return undefined;
  try {
    const url = new URL(entities(raw.trim()), baseUrl);
    return /^https?:$/.test(url.protocol)
      ? url.href.replaceAll("(", "%28").replaceAll(")", "%29")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert GitHub's presentation HTML to readable Markdown, never executable HTML.
 * Run on prose segments only; fenced code stays byte-for-byte intact upstream.
 * Inline code is protected here. Remote images become labelled links so reading
 * a review does not load trackers or expand a badge into a wall of markup.
 */
export function normalizeGitHubMarkdown(text: string, baseUrl: string): string {
  let marker = "CAPSULEINLINECODE";
  while (text.includes(marker)) marker += "X";
  const code: string[] = [];
  const protectedText = text.replace(/`[^`\n]+`/g, (value) => {
    code.push(value);
    return `${marker}${code.length - 1}END`;
  });
  const label = (body: string) => entities(body
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => attribute(attrs, "alt") || "Image")
    .replace(/<[^>]+>/g, ""))
    .replace(/[\[\]`]/g, "").replace(/\s+/g, " ").trim();
  const link = (title: string, href: string) => {
    const safe = githubMarkdownHref(href, baseUrl);
    return safe ? `[${title || "Open link"}](${safe})` : title;
  };
  let result = stripHtmlComments(protectedText)
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_match, attrs: string, body: string) => link(label(body), attribute(attrs, "href")))
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => link(label(attribute(attrs, "alt")) || "Image", attribute(attrs, "src")))
    .replace(/<br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi, (_match, body: string) => `\n\n**${label(body)}**\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, body: string) => `\n\n${"#".repeat(Number(level))} ${label(body)}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(?:p|div|ul|ol|details)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, (_match, title: string, href: string) => link(title, href))
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  result = result.replace(new RegExp(`${marker}(\\d+)END`, "g"), (_match, index: string) => code[Number(index)] ?? "");
  return result;
}

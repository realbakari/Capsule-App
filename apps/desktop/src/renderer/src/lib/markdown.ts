import MarkdownIt, { type Token } from "markdown-it";

// HTML is tokenized, never rendered as HTML. The React renderer explicitly
// converts supported presentation tags and ignores every untrusted attribute.
const MAX_NESTING = 24;
const parser = new MarkdownIt({ html: true, linkify: true, maxNesting: MAX_NESTING });
const plainParser = new MarkdownIt({ html: false, linkify: true, maxNesting: MAX_NESTING });

for (const selected of [parser, plainParser]) {
  const parseDestination = selected.helpers.parseLinkDestination;
  // The normal Markdown unescaper treats Windows path separators before dot
  // directories as punctuation escapes. Preserve only explicit drive paths.
  selected.helpers = { ...selected.helpers, parseLinkDestination(text, start, max) {
    const result = parseDestination(text, start, max);
    if (!result.ok) return result;
    const raw = text[start] === "<" ? text.slice(start + 1, result.pos - 1) : text.slice(start, result.pos);
    return /^[a-z]:\\/i.test(raw) ? { ...result, str: raw } : result;
  } };
  const validateLink = selected.validateLink;
  selected.validateLink = (href) => /^file:/i.test(href) ? markdownFilePath(href) !== undefined : validateLink(href);
}

export interface MarkdownTokens {
  tokens: Token[];
  literal?: string;
}

/** The parser drops over-nested blocks; fall back to readable source instead. */
export function parseMarkdown(content: string, inline = false, allowHtml = true): MarkdownTokens {
  const selected = allowHtml ? parser : plainParser;
  try {
    const tokens = inline ? selected.parseInline(content, {}) : selected.parse(content, {});
    if (tokens.some((token) => token.level >= MAX_NESTING - 1)) return { tokens: [], literal: content };
    return { tokens };
  } catch {
    // A malformed reply must not take the entire conversation out of service.
    return { tokens: [], literal: content };
  }
}

/** Only web destinations are activated; relative review links use their host. */
export function markdownHref(href: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(href, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A display link requests an inspector read, never a shell or external opener. */
export function markdownFilePath(href: string, baseUrl?: string): string | undefined {
  if (baseUrl || !href || href.startsWith("#")) return undefined;
  let path: string;
  try {
    if (/^file:/i.test(href)) {
      const url = new URL(href);
      if (url.search || (url.hostname && url.hostname !== "localhost")) return undefined;
      path = decodeURIComponent(url.pathname) + url.hash;
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } else {
      path = decodeURIComponent(href);
      if (!/^[a-z]:[\\/]/i.test(path) && /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
    }
  } catch { return undefined; }
  // Do not turn remote shares, invisible controls, or query strings into reads.
  /* eslint-disable-next-line no-control-regex -- Reject identities with invisible controls. */
  if (path.length > 2048 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069?]/u.test(path) || /^[\\/]{2}/.test(path)) return undefined;
  return /[\\/]|\.[a-z\d]+(?:[:#]|$)/i.test(path) ? path.replace(/#L(\d+)(?:C(\d+))?$/, (_, line: string, column?: string) => `:${line}${column ? `:${column}` : ""}`) : undefined;
}

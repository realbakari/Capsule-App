import MarkdownIt, { type Token } from "markdown-it";

// HTML is tokenized, never rendered as HTML. The React renderer explicitly
// converts supported presentation tags and ignores every untrusted attribute.
const MAX_NESTING = 24;
const parser = new MarkdownIt({ html: true, linkify: true, maxNesting: MAX_NESTING });
const plainParser = new MarkdownIt({ html: false, linkify: true, maxNesting: MAX_NESTING });

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

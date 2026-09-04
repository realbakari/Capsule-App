import { Fragment, type ReactNode } from "react";

/*
 * A deliberately small tokeniser: strings, comments, numbers, keywords.
 *
 * It is not a grammar and does not try to be — the goal is to stop a code
 * block reading as one undifferentiated wall. Anything it cannot classify is
 * emitted as plain text, so being wrong degrades to "uncoloured", never to
 * mangled output. Text is emitted as React nodes, never as HTML, so a reply
 * cannot inject markup.
 */
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "import", "export", "from", "default", "class", "extends", "new", "await",
  "async", "try", "catch", "finally", "throw", "typeof", "instanceof", "in",
  "interface", "type", "readonly", "implements", "enum", "public", "private",
  "protected", "static", "abstract", "satisfies", "keyof", "infer", "never",
  "boolean", "string", "number", "void", "unknown",
  "of", "this", "null", "undefined", "true", "false", "require", "module",
  "def", "elif", "lambda", "pass", "with", "as", "not", "and", "or", "print",
  "echo", "cd", "ls", "mkdir", "rm", "cp", "mv", "cat", "grep", "npm", "pnpm",
  "node", "git", "sudo", "curl", "then", "fi", "do", "done", "case", "esac",
]);

/** Above this, colouring costs more than it gives; emit plain text. */
const MAX_HIGHLIGHT_CHARS = 20_000;

const TOKEN = new RegExp(
  [
    "(#[^\\n]*|//[^\\n]*|/\\*[\\s\\S]*?\\*/)", // comments
    "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)", // strings
    "(\\b\\d[\\d_.]*\\b)", // numbers
    "([A-Za-z_$][\\w$]*)", // words
  ].join("|"),
  "g",
);

/*
 * The last few blocks tokenised, so a re-render does not redo the work.
 *
 * A streamed reply re-renders on every chunk, and each render re-tokenised
 * every fence in the message — including the ones that finished arriving long
 * ago. Measured on a 6.7KB reply with three fences over 40 chunks: 81 calls
 * and 97ms, where 42 calls and 19ms is the whole of the real work. Diffs and
 * file previews call this too, and re-render for reasons of their own.
 *
 * The result is a tree of React elements, which are immutable descriptors, so
 * handing the same one back to a later render is safe. Bounded, and refreshed
 * on use, because a long session would otherwise hold every block it ever
 * drew.
 */
const CACHE_LIMIT = 24;
const cache = new Map<string, ReactNode>();

/** For tests, and for anywhere that wants the memory back. */
export function clearHighlightCache(): void {
  cache.clear();
}

export function highlight(code: string, language?: string): ReactNode {
  if (code.length > MAX_HIGHLIGHT_CHARS) return code;
  /*
   * The language changes what is emitted, so it belongs in the key. A language
   * never contains \u0000, so the separator marks an unambiguous split no
   * matter what the code contains.
   */
  const cacheKey = `${language ?? ""}\u0000${code}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) {
    // Re-inserting makes this the most recent, so the cache evicts what is
    // genuinely cold rather than whatever was drawn first.
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }
  const lang = (language ?? "").toLowerCase();
  // Prose-ish fences gain nothing from keyword colouring.
  if (lang === "text" || lang === "txt" || lang === "md" || lang === "markdown") return code;

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(<Fragment key={key++}>{code.slice(last, index)}</Fragment>);
    const [raw, comment, str, num, word] = match;
    if (comment) nodes.push(<span className="tok-com" key={key++}>{raw}</span>);
    else if (str) nodes.push(<span className="tok-str" key={key++}>{raw}</span>);
    else if (num) nodes.push(<span className="tok-num" key={key++}>{raw}</span>);
    else if (word && KEYWORDS.has(word)) nodes.push(<span className="tok-kw" key={key++}>{raw}</span>);
    else nodes.push(<Fragment key={key++}>{raw}</Fragment>);
    last = index + raw.length;
  }
  if (last < code.length) nodes.push(<Fragment key={key++}>{code.slice(last)}</Fragment>);

  if (cache.size >= CACHE_LIMIT) {
    // Map iterates in insertion order, so the first key is the coldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, nodes);
  return nodes;
}

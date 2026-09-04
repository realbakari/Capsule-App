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

export function highlight(code: string, language?: string): ReactNode {
  if (code.length > MAX_HIGHLIGHT_CHARS) return code;
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
  return nodes;
}

import type { MarkdownIt, StateBlock, StateCore, StateInline } from "markdown-it";

/*
 * Replies are full of dollar signs that are not math: prices, shell
 * variables, template strings. A `$` opens math only when the next character
 * is not a space, and the next unescaped `$` closes it only when it follows a
 * non-space and is not followed by a word character. "$5 and $10",
 * "$HOME/$USER" and "$1,000-$2,000" stay prose; "$x^2$" is math. Code spans
 * and fences never reach these rules.
 */
const DOLLAR = 0x24;
const MAX_INLINE = 2000;

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/** A number followed by words is a sentence between two prices, not math. */
function readsAsProse(tex: string): boolean {
  return /^\d/.test(tex) && /(?:^|\s)[A-Za-z]{2,}\b/.test(tex);
}

function unescapedDollar(src: string, from: number, end: number): number {
  for (let index = from; index < end; index++) {
    const code = src.charCodeAt(index);
    if (code === 0x5c) { index++; continue; }
    if (code === DOLLAR) return index;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, posMax } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== DOLLAR) return false;
  const display = src.charCodeAt(start + 1) === DOLLAR;
  const open = display ? 2 : 1;
  if ((!display && isSpace(src[start + open])) || src.charCodeAt(start + open) === DOLLAR) return false;
  const limit = Math.min(posMax, start + open + MAX_INLINE);
  let close = unescapedDollar(src, start + open, limit);
  if (close < 0) return false;
  if (display) {
    if (src.charCodeAt(close + 1) !== DOLLAR) return false;
  } else if (isSpace(src[close - 1]) || /[\w$]/.test(src[close + 1] ?? "")) {
    return false;
  }
  const tex = src.slice(start + open, close);
  if (!tex.trim() || tex.includes("`") || (!display && readsAsProse(tex))) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = tex.trim();
    token.markup = display ? "$$" : "$";
  }
  close += open;
  state.pos = close;
  return true;
}

/** `$$` on its own line, closed by a line that ends in `$$`. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine]! + state.tShift[startLine]!;
  let max = state.eMarks[startLine]!;
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  if (!state.src.startsWith("$$", pos)) return false;
  pos += 2;
  let first = state.src.slice(pos, max).trim();
  let last = "";
  let line = startLine;
  let found = false;
  if (first.endsWith("$$")) {
    first = first.slice(0, -2).trim();
    found = true;
  } else {
    while (!found && ++line < endLine) {
      pos = state.bMarks[line]! + state.tShift[line]!;
      max = state.eMarks[line]!;
      if (pos < max && state.sCount[line]! < state.blkIndent) break;
      const text = state.src.slice(pos, max).trimEnd();
      if (text.endsWith("$$")) { last = text.slice(0, -2).trim(); found = true; }
    }
  }
  if (!found) return false;
  if (silent) return true;
  const body = line > startLine + 1 ? state.getLines(startLine + 1, line, state.tShift[startLine]!, true) : "";
  const tex = [first, body.trimEnd(), last].filter(Boolean).join("\n");
  state.line = line + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = tex;
  token.markup = "$$";
  token.map = [startLine, state.line];
  return true;
}

/*
 * The parser closes a fence at the end of the text whether or not its closing
 * marker arrived. A diagram or formula renders only once the marker is there,
 * so a streaming block shows its source instead of a parse error per token.
 */
function markClosedFences(state: StateCore): void {
  let lines: string[] | undefined;
  for (const token of state.tokens) {
    if (token.type !== "fence" || !token.map) continue;
    lines ??= state.src.split("\n");
    const closing = lines[token.map[1] - 1] ?? "";
    const marker = token.markup[0] === "~" ? "~" : "`";
    const closed = token.map[1] - token.map[0] >= 2
      && new RegExp(`^[\\s>]*\\${marker}{${token.markup.length},}\\s*$`).test(closing);
    token.meta = { ...(token.meta as object | null), closed };
  }
}

export function markdownMath(md: MarkdownIt): void {
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.core.ruler.push("closed_fences", markClosedFences);
}

export function fenceClosed(meta: unknown): boolean {
  return (meta as { closed?: boolean } | null)?.closed !== false;
}

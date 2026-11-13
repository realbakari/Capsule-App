/*
 * Links in terminal output.
 *
 * A row of the emulator is not a line of output: a long URL or path wraps onto
 * the next rows, and xterm marks those rows `isWrapped`. Links are found on the
 * joined logical line and mapped back to the cells they cover, so hovering any
 * part of a wrapped link underlines all of it.
 */

export type TerminalLinkTarget =
  /** A server on this machine, opened in the conversation's Browser panel. */
  | { kind: "browser"; url: string }
  /** Any other web address. Leaving Capsule takes a ⌘-click. */
  | { kind: "external"; url: string }
  /** A file inside one of the conversation's folders, opened in Files. */
  | { kind: "file"; root: string; path: string; line?: number; column?: number };

export interface TerminalLinkMatch {
  text: string;
  /** Offsets into the logical line, end exclusive. */
  start: number;
  end: number;
  target: TerminalLinkTarget;
}

export interface TerminalLinkContext {
  /** The folder relative paths are read against. */
  cwd: string;
  /** Folders a file must sit inside to be linked. */
  roots: string[];
}

const URL_PATTERN = /\bhttps?:\/\/[^\s"'`<>]+/gi;
/*
 * A path-shaped token: optional `/`, `./` or `../`, segments joined by `/`, and
 * an optional `:line:column`. The look-behind keeps it from starting inside a
 * word, a URL (`//host`) or a Git remote (`host:owner/repo`).
 */
const PATH_PATTERN = /(?<![\w.@+$~/:-])(?:\.{1,2}\/|\/)?[\w.@+$~-]+(?:\/[\w.@+$~-]+)*(?::\d+){0,2}/g;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

function trimTrailing(value: string, punctuation: RegExp): string {
  let output = value.replace(punctuation, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (output.endsWith(close) && output.split(open).length < output.split(close).length) {
      output = output.slice(0, -1);
    }
  }
  return output;
}

export function isLocalUrl(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
}

function urlTarget(text: string): TerminalLinkTarget | undefined {
  try {
    const url = new URL(text);
    return { kind: isLocalUrl(url) ? "browser" : "external", url: url.toString() };
  } catch {
    return undefined;
  }
}

function normalizeAbsolute(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/**
 * Resolves `src/app.ts:12:3` against `cwd`, and keeps it only when the file is
 * inside one of `roots`. A path outside every root is not a link at all: Files
 * only opens what belongs to the conversation.
 */
export function resolveTerminalPath(text: string, { cwd, roots }: TerminalLinkContext): Extract<TerminalLinkTarget, { kind: "file" }> | undefined {
  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(text);
  const raw = match?.[1] ?? text;
  if (!raw) return undefined;
  const line = match?.[2] ? Number(match[2]) : undefined;
  const column = match?.[3] ? Number(match[3]) : undefined;
  const absolute = normalizeAbsolute(raw.startsWith("/") ? raw : `${cwd}/${raw}`);
  const lower = absolute.toLowerCase();
  // The root goes back exactly as given: Files matches it against its own list.
  const owner = roots
    .map((root) => ({ root, normalized: normalizeAbsolute(root) }))
    .filter(({ normalized }) => lower.startsWith(`${normalized.toLowerCase()}/`))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0];
  if (!owner) return undefined;
  const path = absolute.slice(owner.normalized.length + 1);
  return { kind: "file", root: owner.root, path, ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

/*
 * Words like `and/or` and folders like `src/lib` are path-shaped too. A token
 * is linked when it names a file: a path whose last segment has an extension,
 * or a path or file name followed by a line number.
 */
function looksLikeFile(text: string): boolean {
  const path = text.replace(/(?::\d+){1,2}$/, "");
  const nested = path.includes("/");
  const extension = /\.[\w-]+$/.test(path.slice(path.lastIndexOf("/") + 1));
  return path !== text ? nested || extension : nested && extension;
}

export function findTerminalLinks(line: string, context: TerminalLinkContext): TerminalLinkMatch[] {
  const links: TerminalLinkMatch[] = [];
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimTrailing(match[0], /[.,;:!?'"]+$/);
    const target = urlTarget(text);
    if (target) links.push({ text, start: match.index, end: match.index + text.length, target });
  }
  for (const match of line.matchAll(PATH_PATTERN)) {
    const start = match.index;
    if (links.some((link) => start < link.end && link.start < start + match[0].length)) continue;
    const text = trimTrailing(match[0], /[.,;:!?]+$/);
    if (!looksLikeFile(text)) continue;
    const target = resolveTerminalPath(text, context);
    if (target) links.push({ text, start, end: start + text.length, target });
  }
  return links.sort((a, b) => a.start - b.start);
}

export interface BufferLineLike {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface LogicalLine {
  text: string;
  /** Each buffer row (0-based) and the slice of `text` it holds. */
  rows: Array<{ row: number; start: number; end: number }>;
}

/** Joins the rows a wrapped line spans, starting from any one of them. */
export function logicalLine(getLine: (row: number) => BufferLineLike | undefined, row: number): LogicalLine | undefined {
  let first = row;
  while (first > 0 && getLine(first)?.isWrapped) first--;
  if (!getLine(first)) return undefined;
  const rows: LogicalLine["rows"] = [];
  let text = "";
  for (let current = first; ; current++) {
    const line = getLine(current);
    if (!line) break;
    const continues = getLine(current + 1)?.isWrapped === true;
    const piece = line.translateToString(!continues);
    rows.push({ row: current, start: text.length, end: text.length + piece.length });
    text += piece;
    if (!continues) break;
  }
  return { text, rows };
}

/** xterm ranges are 1-based and include their last cell. */
export function bufferRange(line: LogicalLine, start: number, end: number): { start: { x: number; y: number }; end: { x: number; y: number } } | undefined {
  const at = (offset: number) => line.rows.find((row) => offset >= row.start && offset < row.end);
  const first = at(start);
  const last = at(end - 1);
  if (!first || !last) return undefined;
  return {
    start: { x: start - first.start + 1, y: first.row + 1 },
    end: { x: end - 1 - last.start + 1, y: last.row + 1 },
  };
}

/** What hovering a link tells you, including which click does what. */
export function terminalLinkHint(target: TerminalLinkTarget, modifier: string): string {
  if (target.kind === "browser") return `Open in the Browser panel. ${modifier}-click opens your default browser.`;
  if (target.kind === "external") return `${modifier}-click to open in your default browser.`;
  const position = target.line ? `:${target.line}${target.column ? `:${target.column}` : ""}` : "";
  return `Open ${target.path}${position} in Files.`;
}

/** The folder a shell reports through OSC 7 (`file://host/path`), if it does. */
export function osc7Folder(data: string): string | undefined {
  try {
    const url = new URL(data);
    return url.protocol === "file:" ? decodeURIComponent(url.pathname) : undefined;
  } catch {
    return undefined;
  }
}

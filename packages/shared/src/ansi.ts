export const ANSI_COLOR_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

export type AnsiNamedColor = (typeof ANSI_COLOR_NAMES)[number] | `bright-${(typeof ANSI_COLOR_NAMES)[number]}`;

/** A named colour follows the theme; anything finer is `#rrggbb`. */
export type AnsiColor = AnsiNamedColor | `#${string}`;

export interface AnsiStyle {
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment extends AnsiStyle {
  text: string;
}

export type AnsiLine = AnsiSegment[];

export const MAX_ANSI_LINE_LENGTH = 400;

const ESC = "\u001b";

/** Direction overrides can make a line read differently from what it holds. */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/;

function named(index: number): AnsiNamedColor {
  const base = ANSI_COLOR_NAMES[index % 8]!;
  return index >= 8 ? `bright-${base}` : base;
}

function hex(r: number, g: number, b: number): AnsiColor {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** The first 16 of the 256 palette stay named, so they follow the theme like 30–37 and 90–97 do. */
function palette256(n: number): AnsiColor | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return named(n);
  if (n >= 232) {
    const level = 8 + (n - 232) * 10;
    return hex(level, level, level);
  }
  const cube = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return hex(cube[Math.floor(i / 36)]!, cube[Math.floor(i / 6) % 6]!, cube[i % 6]!);
}

/** Reads `5;n` or `2;r;g;b` after a 38 or 48. Returns the colour and how many params it used. */
function extendedColor(params: number[]): { color?: AnsiColor; used: number } {
  if (params[0] === 5) return { color: palette256(params[1] ?? -1), used: 2 };
  if (params[0] === 2) {
    const [r, g, b] = params.slice(1, 4);
    const valid = [r, g, b].every((c) => c !== undefined && Number.isInteger(c) && c >= 0 && c <= 255);
    return { color: valid ? hex(r!, g!, b!) : undefined, used: 4 };
  }
  return { used: params.length };
}

function applySgr(style: AnsiStyle, paramText: string): AnsiStyle {
  const next: AnsiStyle = { ...style };
  const groups = paramText === "" ? [""] : paramText.split(";");
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    // The colon form packs a colour into one parameter: 38:2::r:g:b or 38:5:n.
    if (group.includes(":")) {
      const sub = group.split(":").map((s) => (s === "" ? Number.NaN : Number(s)));
      const code = sub[0];
      if (code === 38 || code === 48) {
        const rest = sub[1] === 2 && sub.length >= 6 ? [2, ...sub.slice(3, 6)] : sub.slice(1);
        const { color } = extendedColor(rest.map((n) => (Number.isNaN(n) ? -1 : n)));
        if (color) next[code === 38 ? "fg" : "bg"] = color;
      } else if (code === 4) {
        next.underline = sub[1] !== 0;
      }
      continue;
    }
    const code = group === "" ? 0 : Number(group);
    if (!Number.isInteger(code)) continue;
    if (code === 38 || code === 48) {
      const rest = groups.slice(i + 1).map((g) => (g === "" ? 0 : Number(g)));
      const { color, used } = extendedColor(rest);
      if (color) next[code === 38 ? "fg" : "bg"] = color;
      i += used;
      continue;
    }
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof AnsiStyle>) delete next[key];
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4 || code === 21) next.underline = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code >= 30 && code <= 37) next.fg = named(code - 30);
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = named(code - 40);
    else if (code === 49) delete next.bg;
    else if (code >= 90 && code <= 97) next.fg = named(code - 90 + 8);
    else if (code >= 100 && code <= 107) next.bg = named(code - 100 + 8);
  }
  return next;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline;
}

/** Index just past a string-type sequence (OSC, DCS, SOS, PM, APC): ended by BEL or ESC \. */
function endOfString(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\u0007" || text[i] === "\u009c") return i + 1;
    if (text[i] === ESC && text[i + 1] === "\\") return i + 2;
  }
  return text.length;
}

/**
 * Turns a status line command's output into styled plain-text runs. Only SGR
 * styling survives. Every other escape and control character is dropped, and
 * an OSC 8 hyperlink keeps its text but not its target. The result is data
 * for the renderer to draw, never markup.
 */
export function ansiToSegments(text: string, maxLines = 2): AnsiLine[] {
  const lines: AnsiLine[] = [[]];
  const lengths = [0];
  let style: AnsiStyle = {};

  const emit = (chunk: string) => {
    const index = lines.length - 1;
    const room = MAX_ANSI_LINE_LENGTH - lengths[index]!;
    if (room <= 0 || !chunk) return;
    const chars = Array.from(chunk).slice(0, room);
    lengths[index]! += chars.length;
    const line = lines[index]!;
    const last = line[line.length - 1];
    if (last && sameStyle(last, style)) last.text += chars.join("");
    else line.push({ ...style, text: chars.join("") });
  };

  let plain = "";
  const flush = () => {
    emit(plain);
    plain = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);
    if (ch === ESC || ch === "\u009b" || ch === "\u009d" || ch === "\u0090") {
      flush();
      const kind = ch === ESC ? text[i + 1] : ch === "\u009b" ? "[" : ch === "\u009d" ? "]" : "P";
      const start = ch === ESC ? i + 2 : i + 1;
      if (kind === "[") {
        let j = start;
        while (j < text.length && /[0-?]/.test(text[j]!)) j++;
        const params = text.slice(start, j);
        while (j < text.length && /[ -/]/.test(text[j]!)) j++;
        if (text[j] === "m" && /^[\d;:]*$/.test(params)) style = applySgr(style, params);
        i = j;
      } else if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
        i = endOfString(text, start) - 1;
      } else {
        let j = i + 1;
        while (j < text.length && /[ -/]/.test(text[j]!)) j++;
        i = j;
      }
      continue;
    }
    if (ch === "\n") {
      flush();
      if (lines.length >= maxLines) break;
      lines.push([]);
      lengths.push(0);
      continue;
    }
    if (ch === "\t") {
      plain += " ";
      continue;
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || BIDI_CONTROLS.test(ch)) continue;
    plain += ch;
  }
  flush();

  while (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop();
  return lines.length === 1 && lines[0]!.length === 0 ? [] : lines;
}

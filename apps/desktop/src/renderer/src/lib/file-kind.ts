/**
 * File-type marks for the tree.
 *
 * Every row used to carry the same generic page glyph, which meant the icon
 * column cost width and told you nothing. A short label in a colour per family
 * is legible at 13px where a detailed glyph is not, and lets a directory be
 * scanned by shape.
 */

export interface FileKind {
  /** One or two characters. Longer labels stop fitting the icon column. */
  label: string;
  /** A CSS custom property name from the palette, not a literal colour. */
  tone: string;
}

const BY_EXTENSION: Record<string, FileKind> = {
  ts: { label: "TS", tone: "--blue" },
  tsx: { label: "TS", tone: "--blue" },
  mts: { label: "TS", tone: "--blue" },
  cts: { label: "TS", tone: "--blue" },
  js: { label: "JS", tone: "--yellow" },
  jsx: { label: "JS", tone: "--yellow" },
  mjs: { label: "JS", tone: "--yellow" },
  cjs: { label: "JS", tone: "--yellow" },
  json: { label: "{}", tone: "--yellow" },
  md: { label: "MD", tone: "--subtext-0" },
  mdx: { label: "MD", tone: "--subtext-0" },
  css: { label: "CS", tone: "--mauve" },
  scss: { label: "CS", tone: "--mauve" },
  html: { label: "<>", tone: "--peach" },
  py: { label: "PY", tone: "--green" },
  rs: { label: "RS", tone: "--peach" },
  go: { label: "GO", tone: "--blue" },
  rb: { label: "RB", tone: "--red" },
  sh: { label: "$", tone: "--green" },
  zsh: { label: "$", tone: "--green" },
  bash: { label: "$", tone: "--green" },
  yml: { label: "YM", tone: "--peach" },
  yaml: { label: "YM", tone: "--peach" },
  toml: { label: "TM", tone: "--peach" },
  sql: { label: "SQ", tone: "--blue" },
  png: { label: "IM", tone: "--mauve" },
  jpg: { label: "IM", tone: "--mauve" },
  jpeg: { label: "IM", tone: "--mauve" },
  gif: { label: "IM", tone: "--mauve" },
  svg: { label: "SV", tone: "--mauve" },
  webp: { label: "IM", tone: "--mauve" },
  pdf: { label: "PD", tone: "--red" },
  lock: { label: "LK", tone: "--text-faint" },
};

/** Whole-name matches win over the extension: a lockfile is not YAML. */
const BY_NAME: Record<string, FileKind> = {
  "package.json": { label: "PK", tone: "--red" },
  "package-lock.json": { label: "LK", tone: "--text-faint" },
  "pnpm-lock.yaml": { label: "LK", tone: "--text-faint" },
  "yarn.lock": { label: "LK", tone: "--text-faint" },
  "cargo.lock": { label: "LK", tone: "--text-faint" },
  dockerfile: { label: "DK", tone: "--blue" },
  makefile: { label: "MK", tone: "--peach" },
  ".gitignore": { label: "GI", tone: "--text-faint" },
  ".env": { label: "EN", tone: "--yellow" },
};

const FALLBACK: FileKind = { label: "•", tone: "--text-faint" };

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;

  // A dotfile with no other dot ("​.gitignore") has no extension to read.
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) return FALLBACK;
  return BY_EXTENSION[lower.slice(dot + 1)] ?? FALLBACK;
}

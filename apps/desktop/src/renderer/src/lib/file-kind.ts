/**
 * What kind of file a name is, for the Files tree's icon and a file chip's label.
 *
 * One table answers both: `icon` picks the tree glyph, `label` is the short
 * text a chip can fit, and `tone` is a theme token, so every kind follows the
 * light and dark palettes.
 */

export type FileIconId =
  | "file"
  | "text"
  | "code"
  | "typescript"
  | "javascript"
  | "react"
  | "json"
  | "markdown"
  | "css"
  | "html"
  | "shell"
  | "config"
  | "lock"
  | "git"
  | "npm"
  | "pnpm"
  | "vite"
  | "agents"
  | "image"
  | "pdf"
  | "database"
  | "container";

export interface FileKind {
  icon: FileIconId;
  /** One or two characters. Longer labels stop fitting a chip. */
  label: string;
  /** A CSS custom property name from the theme, not a literal colour. */
  tone: string;
}

const kind = (icon: FileIconId, label: string, tone: string): FileKind => ({ icon, label, tone });

const TS = kind("typescript", "TS", "--syntax-keyword");
const TSX = kind("react", "TS", "--syntax-function");
const JS = kind("javascript", "JS", "--yellow");
const JSX = kind("react", "JS", "--syntax-function");
const JSON_KIND = kind("json", "{}", "--syntax-number");
const MD = kind("markdown", "MD", "--syntax-string");
const CSS = kind("css", "CS", "--syntax-keyword");
const SHELL = kind("shell", "$", "--green");
const CONFIG = kind("config", "YM", "--red");
const IMAGE = kind("image", "IM", "--syntax-attribute");
const LOCK = kind("lock", "LK", "--text-faint");
const GIT = kind("git", "GI", "--red");
const NPM = kind("npm", "PK", "--red");
const PNPM = kind("pnpm", "PK", "--yellow");
const VITE = kind("vite", "VI", "--yellow");
const AGENTS = kind("agents", "MD", "--syntax-number");
const code = (label: string, tone: string) => kind("code", label, tone);

const BY_EXTENSION: Record<string, FileKind> = {
  ts: TS, mts: TS, cts: TS,
  tsx: TSX,
  js: JS, mjs: JS, cjs: JS,
  jsx: JSX,
  json: JSON_KIND, jsonc: JSON_KIND, json5: JSON_KIND,
  md: MD, mdx: MD, markdown: MD,
  css: CSS, scss: CSS, sass: CSS, less: CSS,
  html: kind("html", "<>", "--syntax-number"), htm: kind("html", "<>", "--syntax-number"),
  vue: kind("html", "VU", "--green"), svelte: kind("html", "SV", "--red"),
  py: code("PY", "--syntax-keyword"),
  rs: code("RS", "--syntax-number"),
  go: code("GO", "--syntax-function"),
  rb: code("RB", "--red"),
  swift: code("SW", "--syntax-number"),
  kt: code("KT", "--syntax-keyword"),
  java: code("JV", "--syntax-number"),
  c: code("C", "--syntax-keyword"), h: code("H", "--syntax-keyword"),
  cpp: code("C+", "--syntax-keyword"), hpp: code("H+", "--syntax-keyword"),
  cs: code("C#", "--syntax-keyword"),
  php: code("PH", "--syntax-keyword"),
  lua: code("LU", "--syntax-keyword"),
  zig: code("ZG", "--syntax-number"),
  sh: SHELL, zsh: SHELL, bash: SHELL, fish: SHELL, ps1: SHELL,
  yml: CONFIG, yaml: CONFIG,
  toml: kind("config", "TM", "--text-muted"),
  ini: kind("config", "IN", "--text-muted"),
  sql: kind("database", "SQ", "--syntax-keyword"), sqlite: kind("database", "DB", "--syntax-keyword"), db: kind("database", "DB", "--syntax-keyword"),
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, ico: IMAGE, avif: IMAGE, heic: IMAGE,
  svg: kind("image", "SV", "--syntax-number"),
  pdf: kind("pdf", "PD", "--red"),
  lock: LOCK,
  txt: kind("text", "TX", "--text-muted"), log: kind("text", "LG", "--text-muted"),
  csv: kind("text", "CV", "--green"), tsv: kind("text", "TV", "--green"),
};

/** Whole-name matches win over the extension: a lockfile is not YAML. */
const BY_NAME: Record<string, FileKind> = {
  "package.json": NPM,
  "package-lock.json": kind("npm", "LK", "--red"),
  ".npmrc": NPM,
  "pnpm-lock.yaml": kind("pnpm", "LK", "--yellow"),
  "pnpm-workspace.yaml": PNPM,
  "yarn.lock": LOCK,
  "bun.lock": LOCK,
  "cargo.lock": LOCK,
  "tsconfig.json": TS,
  "agents.md": AGENTS,
  "claude.md": AGENTS,
  dockerfile: kind("container", "DK", "--syntax-keyword"),
  "docker-compose.yml": kind("container", "DK", "--syntax-keyword"),
  "compose.yaml": kind("container", "DK", "--syntax-keyword"),
  makefile: kind("config", "MK", "--syntax-number"),
  ".gitignore": GIT,
  ".gitattributes": GIT,
  ".gitmodules": GIT,
  ".gitkeep": GIT,
  ".editorconfig": kind("config", "EC", "--text-muted"),
};

/** `vite.config.ts`, `vitest.config.mts` and friends: the tool's mark, whatever the extension. */
const BY_STEM: Record<string, FileKind> = {
  "vite.config": VITE,
  "vitest.config": VITE,
};

const FALLBACK: FileKind = { icon: "file", label: "•", tone: "--text-faint" };

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;

  // A dotfile with no other dot ("​.gitignore") has no extension to read.
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) return FALLBACK;
  return BY_STEM[lower.slice(0, dot)] ?? BY_EXTENSION[lower.slice(dot + 1)] ?? FALLBACK;
}

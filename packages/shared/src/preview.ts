export type FilePreviewKind = "text" | "image" | "binary";

export interface FilePreview {
  path: string;
  kind: FilePreviewKind;
  language?: string;
  mime?: string;
  contents?: string;
  dataUrl?: string;
  truncated: boolean;
  revision?: string;
  size: number;
  detail?: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  graphql: "graphql",
  vue: "html",
  svelte: "html",
  php: "php",
  r: "r",
  lua: "lua",
  dart: "dart",
};

const BINARY_EXT = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "ogg",
  "webm",
  "class",
  "o",
  "a",
  "pyc",
  "db",
  "sqlite",
  "sqlite3",
  "bin",
  "dat",
  "ico",
]);

export function fileExtension(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function imageMimeFromFilename(path: string): string | undefined {
  return IMAGE_MIME[fileExtension(path)];
}

export function languageFromFilename(path: string): string | undefined {
  const ext = fileExtension(path);
  if (LANGUAGE_BY_EXT[ext]) return LANGUAGE_BY_EXT[ext];
  const base = (path.split(/[/\\]/).pop() ?? "").toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  if (base === "makefile" || base === "gnumakefile") return "make";
  return undefined;
}

export function previewKindFromFilename(path: string): FilePreviewKind | undefined {
  if (imageMimeFromFilename(path)) return "image";
  if (BINARY_EXT.has(fileExtension(path))) return "binary";
  if (languageFromFilename(path)) return "text";
  return undefined;
}

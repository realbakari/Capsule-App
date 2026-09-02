/*
 * Path display helpers.
 *
 * Absolute paths are the least useful thing to put in a narrow column: every
 * project on a machine shares the same prefix, so a mid-string truncation
 * ("/Users/realbak…") throws away the basename — the only part that identifies
 * the project — and keeps the part that never varies.
 *
 * The workspace-relative formatter therefore renders a path against the
 * workspace basename rather than against its full path.
 */

function normalizeSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function canonicalizeWindowsDrivePath(path: string): string {
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function basenameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

function stripRelativePrefixes(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

/**
 * Splits a trailing `:line` or `:line:column` off a path. A Windows drive
 * letter also contains a colon, so only digit runs at the very end count.
 */
export function splitPathAndPosition(value: string): {
  path: string;
  line?: string;
  column?: string;
} {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(value);
  if (!match) return { path: value };
  // Groups 1 and 2 always participate when the pattern matches; the index
  // signature is still optional under noUncheckedIndexedAccess.
  const path = match[1] ?? value;
  const line = match[2];
  const column = match[3];
  if (!line) return { path };
  return column ? { path, line, column } : { path, line };
}

/**
 * Renders `target` relative to `workspaceRoot`, prefixed with the workspace's
 * basename. `/Users/me/Downloads/site/src/app.ts` under `/Users/me/Downloads/site`
 * becomes `site/src/app.ts`. Any `:line:column` suffix is preserved.
 */
export function formatWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): string {
  const { path, line, column } = splitPathAndPosition(pathWithPosition);
  const normalizedPath = canonicalizeWindowsDrivePath(normalizeSeparators(path));

  let displayPath = normalizedPath;
  if (workspaceRoot) {
    const root = canonicalizeWindowsDrivePath(
      normalizeSeparators(trimTrailingSeparators(workspaceRoot)),
    );
    const label = basenameOf(root);
    const pathLower = normalizedPath.toLowerCase();
    const rootLower = root.toLowerCase();

    if (pathLower === rootLower) {
      displayPath = label;
    } else if (pathLower.startsWith(`${rootLower}/`)) {
      displayPath = `${label}/${normalizedPath.slice(root.length + 1)}`;
    } else if (!normalizedPath.startsWith("/")) {
      const relative = stripRelativePrefixes(normalizedPath);
      displayPath = pathLower.startsWith(`${label.toLowerCase()}/`)
        ? normalizedPath
        : `${label}/${relative}`;
    }
  }

  if (!line) return displayPath;
  return `${displayPath}:${line}${column ? `:${column}` : ""}`;
}

/**
 * Renders a project root for display, abbreviating the user's home directory
 * to `~`. Unlike a file path there is no workspace to be relative to, so the
 * goal is to keep the whole path readable rather than reduce it to a basename.
 *
 * `home` must be the real home directory (window.capsule.homeDir). Guessing it
 * from a `/Users/<name>/` shape would render *another* account's directory as
 * `~`, which is worse than not abbreviating at all.
 */
export function formatProjectRoot(
  path: string | undefined,
  options: { home?: string; fallback?: string } = {},
): string {
  const fallback = options.fallback ?? "not set";
  if (!path?.trim()) return fallback;
  const normalized = trimTrailingSeparators(normalizeSeparators(path.trim()));
  if (!normalized) return fallback;

  const home = options.home?.trim()
    ? trimTrailingSeparators(normalizeSeparators(options.home.trim()))
    : undefined;
  if (!home) return normalized;
  if (normalized === home) return "~";
  // The separator keeps `/Users/me-backup` from matching `/Users/me`.
  return normalized.startsWith(`${home}/`) ? `~${normalized.slice(home.length)}` : normalized;
}

/** The project's own folder name — what a person actually calls the project. */
export function projectFolderName(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  return basenameOf(trimTrailingSeparators(normalizeSeparators(path.trim()))) || undefined;
}

/**
 * The path to hand the file reader, given whatever the transcript said.
 *
 * An agent writes paths several ways in the same conversation: absolute,
 * relative to the workspace, prefixed with the workspace's own folder name, or
 * with a `:line` suffix from a stack trace. The reader takes one shape — a
 * path relative to the root — so this is where the others become that.
 */
export function toWorkspaceRelative(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): string {
  const { path } = splitPathAndPosition(pathWithPosition);
  const normalized = canonicalizeWindowsDrivePath(normalizeSeparators(path.trim()));
  if (!workspaceRoot) return stripRelativePrefixes(normalized);

  const root = canonicalizeWindowsDrivePath(
    normalizeSeparators(trimTrailingSeparators(workspaceRoot)),
  );
  const lower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();
  if (lower === rootLower) return ".";
  if (lower.startsWith(`${rootLower}/`)) return normalized.slice(root.length + 1);

  const relative = stripRelativePrefixes(normalized);
  const label = basenameOf(root);
  // "capsule/src/app.ts" inside a workspace called "capsule" means the file,
  // not a folder of the same name one level down.
  if (relative.toLowerCase().startsWith(`${label.toLowerCase()}/`)) {
    return relative.slice(label.length + 1);
  }
  return relative;
}

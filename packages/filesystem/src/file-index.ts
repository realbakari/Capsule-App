import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/*
 * What files a project has, remembered.
 *
 * The picker used to answer every keystroke with a fresh recursive walk of the
 * project: no memory between queries, a depth limit that quietly hid anything
 * further down, a hardcoded list of directories to skip that knows nothing
 * about the project's own .gitignore, and results in whatever order the walk
 * happened to reach them.
 *
 * A repository already keeps this list, and keeps it correctly: `git ls-files`
 * reports what is tracked plus what is untracked and not ignored, which is
 * exactly the set someone means by "the files in this project". It answers for
 * sixteen thousand files in about two hundred milliseconds, so it is read once
 * and kept until the tree changes.
 */

const SCAN_TIMEOUT_MS = 10_000;

/** How long a listing is trusted before it is read again. */
export const FILE_INDEX_TTL_MS = 30_000;

/** Directories worth skipping when a project is not a repository. */
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  "coverage",
  "build",
  "Pods",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "vendor",
  ".turbo",
  ".cache",
]);

/**
 * Every file the project has, relative to its root.
 *
 * Git first, because it is both faster and more correct — it honours the
 * project's own ignore rules. The walk is for a folder that is not a
 * repository, and it is the only place a depth limit still applies, because
 * without ignore rules a deep walk can wander into places nobody wants
 * indexed.
 */
export async function readProjectFiles(root: string): Promise<string[]> {
  if (!(await fs.stat(root)).isDirectory()) throw new Error("The project folder is unavailable.");
  const fromGit = await gitFiles(root);
  if (fromGit) return fromGit;
  return walkFiles(root);
}

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    const inside = await execute("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      timeout: 3_000,
    });
    if (inside.stdout.trim() !== "true") return undefined;
  } catch {
    return undefined;
  }
  // A failed repository read is not permission to bypass its ignore rules.
  const listed = await execute(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", timeout: SCAN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
  );
  // -z, because a file name may contain anything except NUL.
  return [...new Set(listed.stdout.split("\0").filter(Boolean))];
}

async function walkFiles(root: string, limit = 20_000): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, relative: string, depth: number) => {
    if (out.length >= limit || depth > 8) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (depth === 0) throw error;
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (SKIP.has(entry.name) || entry.name === ".DS_Store") continue;
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") {
        continue;
      }
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel, depth + 1);
        continue;
      }
      if (entry.isFile()) out.push(rel);
    }
  };
  await walk(root, "", 0);
  return out;
}

/**
 * How well a path answers a query, or nothing when it does not.
 *
 * Walk order is not an answer: searching "index" in a large project returned
 * whichever eighty files the walk reached first. The name matters more than
 * the folders above it, and a name that starts with what was typed matters
 * more than one that merely contains it.
 */
export function scorePath(relative: string, needle: string): number | undefined {
  if (!needle) return 0;
  const lowerPath = relative.toLowerCase();
  const name = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  const at = name.indexOf(needle);
  if (at === 0) return name === needle ? 0 : 1;
  if (at > 0) return 2;
  if (lowerPath.includes(needle)) return 3;
  // A path typed with separators, matched loosely: "web/store" finds
  // apps/web/src/composerDraftStore.ts.
  const parts = needle.split(/[\s/]+/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => lowerPath.includes(part))) return 4;
  return undefined;
}

export interface RankedFile {
  path: string;
  name: string;
}

/** The best matches first, shortest path breaking a tie. */
export function rankFiles(files: readonly string[], query: string, limit = 80): RankedFile[] {
  const needle = query.trim().toLowerCase();
  const scored: Array<{ path: string; score: number }> = [];
  for (const file of files) {
    const score = scorePath(file, needle);
    if (score === undefined) continue;
    scored.push({ path: file, score });
    // Without a query every file scores the same, so stop once there are
    // enough rather than sorting the whole project.
    if (!needle && scored.length >= limit) break;
  }
  scored.sort((left, right) => left.score - right.score || left.path.length - right.path.length);
  return scored.slice(0, limit).map((row) => ({
    path: row.path,
    name: row.path.slice(row.path.lastIndexOf("/") + 1),
  }));
}

interface Entry {
  files: string[];
  at: number;
}

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<string[]>>();

/** Drops what is remembered, for a tree that has changed under us. */
export function clearFileIndex(root?: string): void {
  if (root) { cache.delete(root); pending.delete(root); }
  else { cache.clear(); pending.clear(); }
}

/** The project's files, from memory when it is fresh enough. */
export async function projectFiles(root: string, now = Date.now()): Promise<string[]> {
  const cached = cache.get(root);
  if (cached && now - cached.at < FILE_INDEX_TTL_MS) return cached.files;
  const existing = pending.get(root);
  if (existing) return existing;
  const scan = readProjectFiles(root).then((files) => {
    // An invalidation during the scan must not refill the cache with old data.
    if (pending.get(root) === scan) cache.set(root, { files, at: now });
    return files;
  }).finally(() => {
    if (pending.get(root) === scan) pending.delete(root);
  });
  pending.set(root, scan);
  return scan;
}

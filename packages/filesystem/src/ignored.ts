import { execFile } from "node:child_process";
import { FILE_INDEX_TTL_MS, UNINDEXED_DIRECTORIES } from "./file-index.js";

/*
 * Which entries of a folder listing the project ignores, so the Files tree can
 * dim them instead of hiding them.
 *
 * The tree polls every few seconds, and the same folder lists the same names
 * each time, so an answer is kept for as long as the file index keeps its own.
 * A new name changes the key and is asked about straight away.
 */

const TIMEOUT_MS = 5_000;
const cache = new Map<string, { ignored: ReadonlySet<string>; at: number }>();

function checkIgnore(root: string, paths: readonly string[]): Promise<Set<string> | undefined> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["check-ignore", "--stdin", "-z"],
      { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
      (error, stdout) => {
        // 1 means none of them is ignored; anything else is "not a repository" or a failure.
        const code = (error as { code?: unknown } | null)?.code;
        if (error && code !== 1) return resolve(undefined);
        resolve(new Set(stdout.split("\0").filter(Boolean)));
      },
    );
    child.stdin?.end(paths.join("\0"));
  });
}

/** Paths (relative to `root`) that are ignored. Outside a repository, the well-known build folders. */
export async function ignoredPaths(root: string, paths: readonly string[], now = Date.now()): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return new Set();
  const key = `${root}\0${paths.join("\0")}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < FILE_INDEX_TTL_MS) return cached.ignored;
  const fromGit = await checkIgnore(root, paths);
  const ignored = fromGit ?? new Set(paths.filter((item) => UNINDEXED_DIRECTORIES.has(item.slice(item.lastIndexOf("/") + 1))));
  if (cache.size > 500) cache.clear();
  cache.set(key, { ignored, at: now });
  return ignored;
}

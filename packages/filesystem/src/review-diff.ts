import { copyFile, lstat, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseUnifiedDiff, type GitDiffOptions, type OmittedDiffFile, type ReviewCommit, type ReviewTargets } from "@capsule/shared";
import { git, gitExcerpt, inRepository } from "./git-process.js";
import { CANONICAL_PATCH_FLAGS } from "./git-output.js";
import { readFailure } from "./git.js";

/** The most text Review reads for one diff. */
export const REVIEW_DIFF_BYTES = 16 * 1024 * 1024;
/** A new file bigger than this is listed, not diffed. */
export const REVIEW_NEW_FILE_BYTES = 1_000_000;
/** New files diffed in one read; the rest are listed. */
export const REVIEW_NEW_FILE_LIMIT = 200;
const REVIEW_COMMIT_LIMIT = 100;

const DIFF = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--find-renames", ...CANONICAL_PATCH_FLAGS];

export interface ReviewPatch {
  patch: string;
  omitted: OmittedDiffFile[];
}

/**
 * One Review diff that never fails because the change is large. `args` picks
 * what is compared (a tree, `--cached`, or nothing for the index); with
 * `untracked`, new files join the diff as intent-to-add entries in a copy of
 * the index, so a moved file pairs with its old path as a rename. The real
 * index is never written. New files over the size or count budget, and
 * whatever follows the byte budget, come back in `omitted` instead of
 * failing the whole read.
 */
export async function readReviewPatch(cwd: string, args: string[], relative: string | undefined, options: { untracked: boolean; ignoreWhitespace?: boolean }): Promise<ReviewPatch> {
  const paths = ["--", ...(relative ? [relative] : [])];
  const omitted: OmittedDiffFile[] = [];
  const index = options.untracked ? await untrackedIndex(cwd, paths, omitted) : undefined;
  try {
    const env = index ? { ...process.env, GIT_INDEX_FILE: index.file } : process.env;
    const diff = [...DIFF, ...(options.ignoreWhitespace ? ["-w"] : []), ...args, ...paths];
    const result = await gitExcerpt(cwd, diff, REVIEW_DIFF_BYTES, 30_000, env)
      .catch(async (error: Error) => { throw new Error(await readFailure(cwd, error.message, "Could not read the diff.")); });
    if (!result.truncated) return { patch: result.stdout, omitted };
    // Keep only whole files; every file the budget cut off is listed instead.
    const cut = result.stdout.lastIndexOf("\ndiff --git ");
    const patch = cut > 0 ? result.stdout.slice(0, cut + 1) : "";
    const shown = new Set(parseUnifiedDiff(patch).flatMap((file) => [file.path, ...(file.oldPath ? [file.oldPath] : [])]));
    const names = await gitExcerpt(cwd, [...DIFF.filter((flag) => flag !== "--find-renames"), "--name-only", "-z", ...args, ...paths], 4 * 1024 * 1024, 30_000, env);
    for (const name of names.stdout.split("\0")) {
      if (name && !shown.has(name)) omitted.push({ path: name, reason: "limit" });
    }
    return { patch, omitted };
  } finally {
    if (index) await rm(index.folder, { recursive: true, force: true });
  }
}

/*
 * New files as intent-to-add entries in a copy of the index. Smallest first,
 * so which files fit does not depend on how their names sort.
 */
async function untrackedIndex(cwd: string, paths: string[], omitted: OmittedDiffFile[]): Promise<{ folder: string; file: string } | undefined> {
  const listing = await git(cwd, ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", ...paths]);
  if (!listing.ok) throw new Error(await readFailure(cwd, listing.stderr, "Could not read untracked files."));
  const names = [...new Set(listing.stdout.split("\0").filter(Boolean))];
  if (names.length === 0) return undefined;
  const sized: Array<{ name: string; bytes: number }> = [];
  for (let offset = 0; offset < names.length; offset += 16) {
    const batch = await Promise.all(names.slice(offset, offset + 16).map(async (name) => {
      const info = await lstat(path.join(cwd, name)).catch(() => undefined);
      return info && (info.isFile() || info.isSymbolicLink()) ? { name, bytes: info.size } : undefined;
    }));
    for (const entry of batch) if (entry) sized.push(entry);
  }
  const chosen: string[] = [];
  let bytes = 0;
  for (const entry of sized.sort((a, b) => a.bytes - b.bytes || a.name.localeCompare(b.name))) {
    if (entry.bytes > REVIEW_NEW_FILE_BYTES) omitted.push({ path: entry.name, reason: "too-large", bytes: entry.bytes });
    else if (chosen.length >= REVIEW_NEW_FILE_LIMIT || bytes + entry.bytes > REVIEW_DIFF_BYTES / 2) omitted.push({ path: entry.name, reason: "limit", bytes: entry.bytes });
    else { chosen.push(entry.name); bytes += entry.bytes; }
  }
  if (chosen.length === 0) return undefined;
  const folder = await mkdtemp(path.join(tmpdir(), "capsule-review-index-"));
  const file = path.join(folder, "index");
  try {
    const env = { ...process.env, GIT_INDEX_FILE: file };
    const located = await git(cwd, ["rev-parse", "--git-path", "index"]);
    const real = path.resolve(cwd, located.stdout.trim());
    const copied = located.ok && await copyFile(real, file).then(() => true, () => false);
    if (copied) {
      // The copy keeps the index's own time, so entries written in its last second stay racy and are re-read.
      const seconds = Math.floor((await stat(real)).mtimeMs / 1000);
      await utimes(file, seconds, seconds);
      // A split index names a shared file beside the real one; write the copy whole.
      await git(cwd, ["-c", "core.splitIndex=false", "update-index", "--no-split-index"], env);
    } else {
      await git(cwd, ["read-tree", "--empty"], env);
    }
    for (let offset = 0; offset < chosen.length; offset += 100) {
      const added = await git(cwd, ["-c", "core.splitIndex=false", "-c", "core.sparseCheckout=false", "--literal-pathspecs", "add", "--intent-to-add", "--", ...chosen.slice(offset, offset + 100)], env);
      if (!added.ok) throw new Error(await readFailure(cwd, added.stderr, "Could not read untracked files."));
    }
    return { folder, file };
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

const emptyTrees = new Map<string, Promise<string>>();
/** The empty tree, whose ID depends on the repository's hash. */
function emptyTree(cwd: string): Promise<string> {
  let pending = emptyTrees.get(cwd);
  if (!pending) {
    pending = git(cwd, ["hash-object", "-t", "tree", process.platform === "win32" ? "NUL" : "/dev/null"]).then((result) => {
      if (!result.ok) { emptyTrees.delete(cwd); throw new Error(result.stderr || "Could not read the empty tree."); }
      return result.stdout.trim();
    });
    emptyTrees.set(cwd, pending);
  }
  return pending;
}

async function hasHead(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])).ok;
}

/** Every change in the working tree against the last commit, new files included. */
export async function readWorkingTreePatch(cwd: string, relative?: string, options: GitDiffOptions = {}): Promise<ReviewPatch> {
  const base = await hasHead(cwd) ? "HEAD" : await emptyTree(cwd);
  return readReviewPatch(cwd, [base], relative, { untracked: true, ignoreWhitespace: options.ignoreWhitespace });
}

export async function readGitDiff(workingDirectory: string, relative?: string, options: GitDiffOptions = {}): Promise<string> {
  return inRepository(workingDirectory, async () => (await readWorkingTreePatch(workingDirectory, relative, options)).patch,
    JSON.stringify(["readGitDiff", workingDirectory, relative, Boolean(options.ignoreWhitespace)]));
}

async function resolves(cwd: string, ref: string): Promise<boolean> {
  return !ref.startsWith("-") && (await git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`])).ok;
}

/*
 * The branch work started from: where origin/HEAD points, else a local main
 * or master. A local branch wins over its remote copy, because a worktree
 * conversation branches from the local one.
 */
export async function defaultBranch(cwd: string): Promise<string | undefined> {
  const remoteHead = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const remoteName = remoteHead.ok ? remoteHead.stdout.trim() : "";
  const local = remoteName.replace(/^origin\//, "");
  const candidates = [...(local ? [local, remoteName] : []), "main", "master", "origin/main", "origin/master"];
  for (const name of candidates) {
    if (await resolves(cwd, name)) return name;
  }
  return undefined;
}

/** The chosen base while it still resolves, else the default branch. */
export async function reviewBase(cwd: string, chosen?: string): Promise<string | undefined> {
  if (chosen && await resolves(cwd, chosen)) return chosen;
  return defaultBranch(cwd);
}

/** Refs Branch can measure from, and the commits HEAD has made since it left the base. */
export async function readReviewTargets(cwd: string, chosen?: string): Promise<ReviewTargets> {
  return inRepository(cwd, async () => {
    const refs = await git(cwd, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
    const local: string[] = [];
    const remote: string[] = [];
    for (const ref of refs.ok ? refs.stdout.split(/\r?\n/) : []) {
      if (ref.startsWith("refs/heads/")) local.push(ref.slice("refs/heads/".length));
      else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) remote.push(ref.slice("refs/remotes/".length));
    }
    const base = await reviewBase(cwd, chosen);
    if (!await hasHead(cwd)) return { bases: { local, remote }, ...(base ? { base } : {}), commits: [] };
    const since = base ? await git(cwd, ["merge-base", "--end-of-options", base, "HEAD"]) : undefined;
    const range = since?.ok ? [`${since.stdout.trim()}..HEAD`] : ["HEAD"];
    const log = await git(cwd, ["log", `--max-count=${REVIEW_COMMIT_LIMIT + 1}`, "--format=%H%x00%an%x00%aI%x00%s%x1e", "--end-of-options", ...range, "--"]);
    if (!log.ok) throw new Error(await readFailure(cwd, log.stderr, "Could not list this branch's commits."));
    const commits: ReviewCommit[] = log.stdout.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
      const [oid = "", author = "", date = "", subject = ""] = record.split("\0");
      return { oid, author, date, subject };
    });
    return {
      bases: { local, remote },
      ...(base ? { base } : {}),
      commits: commits.slice(0, REVIEW_COMMIT_LIMIT),
      ...(commits.length > REVIEW_COMMIT_LIMIT ? { commitsTruncated: true } : {}),
    };
  }, JSON.stringify(["readReviewTargets", cwd, chosen]));
}

/** What one commit changed, against its first parent (or nothing, for a root commit). */
export async function readCommitPatch(cwd: string, oid: string, relative: string | undefined, options: GitDiffOptions): Promise<ReviewPatch & { base?: string }> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(oid)) throw new Error("Choose a commit by its full commit ID.");
  const parent = await git(cwd, ["rev-parse", "--verify", "--quiet", `${oid}^1^{commit}`]);
  const from = parent.ok ? parent.stdout.trim() : await emptyTree(cwd);
  const read = await readReviewPatch(cwd, [from, oid], relative, { untracked: false, ignoreWhitespace: options.ignoreWhitespace });
  return { ...read, ...(parent.ok ? { base: from } : {}) };
}

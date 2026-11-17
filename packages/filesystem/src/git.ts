import { inRepository } from "./git-process.js";
import fs from "node:fs";
import { lstat, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { GitChange, GitDiffOptions, GitStatus } from "@capsule/shared";
import { git } from "./git-process.js";
import { CANONICAL_PATCH_FLAGS, parsePorcelain, parseNumstat } from "./git-output.js";
import { readBoundedFile } from "./bounded-read.js";

export async function readGitStatus(workingDirectory?: string): Promise<GitStatus> {
  return inRepository(workingDirectory, async () => {

    if (!workingDirectory || !fs.existsSync(workingDirectory)) {
      return {
        available: false,
        isRepo: false,
        dirty: false,
        changed: 0,
        summary: "No working directory.",
        files: [],
        branches: [],
      };
    }
    const gitDir = path.join(workingDirectory, ".git");
    const inside = await git(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.stdout.trim() !== "true" && !fs.existsSync(gitDir)) {
      return {
        available: true,
        isRepo: false,
        dirty: false,
        changed: 0,
        summary: "Not a git repository.",
        files: [],
        branches: [],
      };
    }
    const branch =
      (await git(workingDirectory, ["branch", "--show-current"])).stdout.trim() ||
      (await git(workingDirectory, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() ||
      "HEAD";
    const result = await git(workingDirectory, [...DISPLAY_READ, "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (!result.ok) throw new Error(await readFailure(workingDirectory, result.stderr, "Could not read Git status."));
    const porcelain = result.stdout;
    const files = await applyLineStats(workingDirectory, parsePorcelain(porcelain));
    const added = sumStat(files, "added");
    const removed = sumStat(files, "removed");
    // `git branch` reads each branch's commit; for-each-ref reads only the refs.
    const branches = (await git(workingDirectory, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]))
      .stdout.split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      available: true,
      isRepo: true,
      branch,
      dirty: files.length > 0,
      changed: files.length,
      summary: files.length > 0 ? `${branch} · ${files.length} changed` : `${branch} · clean`,
      files,
      branches,
      ...(added === undefined ? {} : { added }),
      ...(removed === undefined ? {} : { removed }),
    };

  }, JSON.stringify(["readGitStatus", workingDirectory]));
}

/*
 * Status and line counts compare only size, mode and whole-second mtime.
 * Git's default also checks ctime and inode, which cloud-synced folders
 * (iCloud's Desktop & Documents) change when they offload a file; Git then
 * re-reads every such file to hash it, each read waits on a download, and
 * the status of an untouched repository outlasts the timeout. These reads
 * never write the index (GIT_OPTIONAL_LOCKS=0), so nothing heals it.
 */
const DISPLAY_READ = ["-c", "core.checkStat=minimal"];

/** A file the system has offloaded to the cloud: reading it waits on a download that may never come. */
export function isOffloaded(info: { size: number; blocks: number; isFile(): boolean }, platform = process.platform): boolean {
  return platform === "darwin" && info.isFile() && info.size > 0 && info.blocks === 0;
}

/*
 * `git status --porcelain` says which files changed but not by how much.
 * A single `--numstat` covering both staged and unstaged work is one extra
 * process for the whole tree, rather than a diff per file.
 */
async function applyLineStats(workingDirectory: string, files: GitChange[]): Promise<GitChange[]> {
  if (files.length === 0) return files;
  const stats = new Map<string, { added: number; removed: number; }>();
  const hasHead = (await git(workingDirectory, ["rev-parse", "--verify", "HEAD"])).ok;
  // Counts are a summary: an offloaded file or a slow read leaves them out rather than failing the status.
  if (hasHead && !(await anyOffloaded(workingDirectory, files))) {
    const out = await git(workingDirectory, [...DISPLAY_READ, "diff-index", "-M", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "HEAD", "--"], process.env, 10_000);
    for (const entry of out.ok ? parseNumstat(out.stdout) : []) {
      if (entry.added === undefined || entry.removed === undefined) continue;
      stats.set(entry.path, { added: entry.added, removed: entry.removed });
    }
  }
  const countFile = async (file: GitChange): Promise<GitChange> => {
    const stat = stats.get(file.path);
    if (stat) return { ...file, added: stat.added, removed: stat.removed };
    if (!hasHead || file.code.includes("?")) {
      try {
        const fullPath = path.join(workingDirectory, file.path);
        const info = await lstat(fullPath);
        if (info.isFile() && info.size <= 1_000_000 && !isOffloaded(info)) {
          const content = (await readBoundedFile(fullPath, 1_000_000, workingDirectory)).toString("utf8");
          if (content.includes("\0")) return file;
          const lineCount = content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
          return { ...file, added: lineCount, removed: 0 };
        }
      } catch {
        // ignore binary or unreadable file
      }
    }
    return file;
  };
  const counted: GitChange[] = [];
  // Bound open files and retained buffers on newly generated or very large trees.
  for (let offset = 0; offset < files.length; offset += 8) {
    counted.push(...await Promise.all(files.slice(offset, offset + 8).map(countFile)));
  }
  return counted;
}

export const OFFLOADED_DATABASE = "This repository's Git data is in iCloud and not downloaded to this Mac, so Git cannot read it. In Finder, Control-click the folder and choose Download Now.";

/*
 * Git reads the index, its packs and loose objects; an offloaded one waits on
 * an iCloud download. Loose objects are sampled, not walked: a few hundred
 * lstat calls answer the question without stalling on a large store.
 */
export async function gitDataOffloaded(workingDirectory: string): Promise<boolean> {
  if (await databaseOffloaded(workingDirectory)) return true;
  const located = await git(workingDirectory, ["rev-parse", "--git-common-dir"]);
  if (!located.ok) return false;
  const objects = path.join(path.resolve(workingDirectory, located.stdout.trim()), "objects");
  const folders = (await fs.promises.readdir(objects).catch(() => [] as string[])).filter((name) => /^[0-9a-f]{2}$/.test(name));
  let checked = 0;
  for (const folder of folders) {
    for (const name of await fs.promises.readdir(path.join(objects, folder)).catch(() => [] as string[])) {
      const info = await lstat(path.join(objects, folder, name)).catch(() => undefined);
      if (info && isOffloaded(info)) return true;
      if (++checked >= 300) return false;
    }
  }
  return false;
}

/** Why a read failed: an offloaded repository says how to bring it back rather than that Git timed out. */
export async function readFailure(workingDirectory: string, stderr: string, fallback: string): Promise<string> {
  return await databaseOffloaded(workingDirectory) ? OFFLOADED_DATABASE : stderr || fallback;
}

/* Status reads the index and whichever packs hold HEAD's trees; an offloaded one waits on a download. */
async function databaseOffloaded(workingDirectory: string): Promise<boolean> {
  const located = await git(workingDirectory, ["rev-parse", "--git-path", "index", "--git-common-dir"]);
  if (!located.ok) return false;
  const [index, common] = located.stdout.split(/\r?\n/).map((line) => path.resolve(workingDirectory, line.trim()));
  const packs = common ? path.join(common, "objects", "pack") : undefined;
  const names = packs ? await fs.promises.readdir(packs).catch(() => [] as string[]) : [];
  const candidates = [index, ...names.filter((name) => /\.(pack|idx)$/.test(name)).map((name) => path.join(packs!, name))];
  for (const file of candidates) {
    const info = file ? await lstat(file).catch(() => undefined) : undefined;
    if (info && isOffloaded(info)) return true;
  }
  return false;
}

async function anyOffloaded(workingDirectory: string, files: GitChange[]): Promise<boolean> {
  for (const file of files) {
    if (file.code.includes("?") || file.code.includes("D")) continue;
    const info = await lstat(path.join(workingDirectory, file.path)).catch(() => undefined);
    if (info && isOffloaded(info)) return true;
  }
  return false;
}

function sumStat(files: GitChange[], key: "added" | "removed"): number | undefined {
  const counted = files.filter((file) => typeof file[key] === "number");
  if (counted.length === 0) return undefined;
  return counted.reduce((total, file) => total + (file[key] ?? 0), 0);
}

export async function checkoutBranch(workingDirectory: string, branch: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const name = branch.trim();
    if (!name || name.startsWith("-")) return { ok: false, detail: "Choose a valid branch name." };
    // A branch deleted since the menu loaded must fail, never become a
    // same-named path checkout that silently discards working-tree edits.
    const result = await git(workingDirectory, ["checkout", name, "--"]);
    if (result.ok) return { ok: true, detail: `Checked out ${name}.` };
    return { ok: false, detail: result.stderr || result.stdout || "Checkout failed." };

  });
}

/** The most text Review reads for one diff. */
export const REVIEW_DIFF_BYTES = 16 * 1024 * 1024;

export async function readGitDiff(workingDirectory: string, relative?: string, options: GitDiffOptions = {}): Promise<string> {
  return inRepository(workingDirectory, async () => {

    const paths = relative ? ["--", relative] : [];
    const whitespace = options.ignoreWhitespace ? ["-w"] : [];
    const hasHead = (await git(workingDirectory, ["rev-parse", "--verify", "HEAD"])).ok;
    const result = hasHead
      ? await git(workingDirectory, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", ...CANONICAL_PATCH_FLAGS, ...whitespace, "HEAD", ...paths])
      : { ok: true, stdout: "", stderr: "" };
    if (!result.ok) throw new Error(await readFailure(workingDirectory, result.stderr, "Could not read the combined working-tree diff."));
    return result.stdout + await readUntrackedPatches(workingDirectory, relative, !hasHead, REVIEW_DIFF_BYTES - Buffer.byteLength(result.stdout));

  }, JSON.stringify(["readGitDiff", workingDirectory, relative, Boolean(options.ignoreWhitespace)]));
}

/**
 * New files git does not track yet, as creation patches. With `cached`, files
 * already added before the first commit count too.
 */
export async function readUntrackedPatches(workingDirectory: string, relative: string | undefined, cached: boolean, budget: number): Promise<string> {
  const paths = relative ? ["--", relative] : [];
  const listing = await git(workingDirectory, ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", ...(cached ? ["--cached"] : []), ...paths]);
  if (!listing.ok) throw new Error(await readFailure(workingDirectory, listing.stderr, "Could not read untracked files."));
  const names = [...new Set(listing.stdout.split("\0").filter(Boolean))];
  if (names.length > 200) throw new Error("More than 200 new files need review. Select individual files to inspect them before committing.");
  const patches: string[] = [];
  let bytes = 0;
  for (let offset = 0; offset < names.length; offset += 8) {
    const batch = await Promise.all(names.slice(offset, offset + 8).map(async (name) => {
      const info = await lstat(path.join(workingDirectory, name)).catch(() => undefined);
      if (!info) return ""; // Deleted before the first commit.
      if (!info.isFile() && !info.isSymbolicLink()) return "";
      if (info.size > 1_000_000) throw new Error(`New file ${name} is too large to review here. Inspect it before committing.`);
      const patch = await git(workingDirectory, ["--literal-pathspecs", "diff", "--no-index", "--no-ext-diff", "--no-textconv", ...CANONICAL_PATCH_FLAGS, "--", "/dev/null", name]);
      // --no-index exits 1 when files differ, which is its successful result.
      if (!patch.stdout.startsWith("diff --git ")) throw new Error(patch.stderr || `Could not review ${name}.`);
      return patch.stdout;
    }));
    for (const patch of batch) {
      bytes += Buffer.byteLength(patch);
      if (bytes > budget) throw new Error("The combined diff exceeds 16 MB. Review individual files before committing.");
      patches.push(patch);
    }
  }
  return patches.join("");
}

export async function stageFile(workingDirectory: string, relative: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const result = await git(workingDirectory, ["--literal-pathspecs", "add", "--", relative]);
    if (result.ok) return { ok: true, detail: `Staged ${relative}.` };
    return { ok: false, detail: result.stderr || "Stage failed." };

  });
}

export async function discardFile(workingDirectory: string, relative: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const restored = await git(workingDirectory, ["--literal-pathspecs", "restore", "--worktree", "--source=HEAD", "--", relative]);
    if (restored.ok) return { ok: true, detail: `Restored ${relative}.` };
    const checked = await git(workingDirectory, ["--literal-pathspecs", "checkout", "--", relative]);
    if (checked.ok) return { ok: true, detail: `Restored ${relative}.` };
    const target = path.join(workingDirectory, relative);
    const root = await realpath(workingDirectory);
    const parent = await realpath(path.dirname(target));
    const within = path.relative(root, path.join(parent, path.basename(target)));
    const untracked = await git(workingDirectory, ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", relative]);
    if (within && !within.startsWith("..") && !path.isAbsolute(within) && untracked.ok && untracked.stdout.split("\0").includes(relative)) {
      await unlink(target);
      return { ok: true, detail: `Removed ${relative}.` };
    }
    return { ok: false, detail: restored.stderr || checked.stderr || "Discard failed." };

  });
}

export async function commitAll(workingDirectory: string, message: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const text = message.trim();
    if (!text) return { ok: false, detail: "Commit message is empty." };
    const staged = await git(workingDirectory, ["add", "-A"]);
    if (!staged.ok) return { ok: false, detail: staged.stderr || "Stage failed; nothing committed." };
    const result = await git(workingDirectory, ["commit", "-m", text]);
    if (result.ok) return { ok: true, detail: result.stdout.trim() || "Committed." };
    return { ok: false, detail: result.stderr || result.stdout.trim() || "Commit failed." };

  });
}

export async function createBranch(workingDirectory: string, branch: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const name = branch.trim();
    if (!name || name.startsWith("-")) return { ok: false, detail: "Choose a valid branch name." };
    const result = await git(workingDirectory, ["checkout", "-b", name]);
    if (result.ok) return { ok: true, detail: `Created ${name}.` };
    return { ok: false, detail: result.stderr || "Could not create branch." };

  });
}

export async function initializeRepository(workingDirectory: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    if (!workingDirectory || !fs.existsSync(workingDirectory)) {
      return { ok: false, detail: "Choose a project folder first." };
    }
    const existing = await git(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
    if (existing.ok && existing.stdout.trim() === "true") {
      return { ok: true, detail: "Git is already initialized." };
    }
    const result = await git(workingDirectory, ["init"]);
    if (result.ok) return { ok: true, detail: result.stdout.trim() || "Initialized Git." };
    return { ok: false, detail: result.stderr || "Could not initialize Git." };

  });
}

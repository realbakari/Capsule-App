import { inRepository } from "./git-process.js";
import fs from "node:fs";
import { lstat, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { GitChange, GitCommitScope, GitStatus } from "@capsule/shared";
import { git } from "./git-process.js";
import { hookFailure, readClientHooks, readTracking } from "./git-sync.js";
import { parsePorcelain, parseNumstat } from "./git-output.js";
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
    const inside = await git(workingDirectory, ["rev-parse", "--is-inside-work-tree", "--show-toplevel"]);
    const [insideLine, toplevel] = inside.stdout.split(/\r?\n/).map((line) => line.trim());
    if (insideLine !== "true" && !fs.existsSync(gitDir)) {
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
    // for-each-ref reads only refs and config; ahead and behind walk one branch.
    const [{ branches, remoteBranches, checkedOutElsewhere, ...tracking }, hooks] = await Promise.all([
      readTracking(workingDirectory, branch === "HEAD" ? undefined : branch, insideLine === "true" ? toplevel : undefined),
      readClientHooks(workingDirectory),
    ]);
    return {
      available: true,
      isRepo: true,
      branch,
      dirty: files.length > 0,
      changed: files.length,
      summary: files.length > 0 ? `${branch} · ${files.length} changed` : `${branch} · clean`,
      files,
      branches,
      ...tracking,
      ...(remoteBranches.length ? { remoteBranches } : {}),
      ...(Object.keys(checkedOutElsewhere).length ? { checkedOutElsewhere } : {}),
      ...(hooks.length ? { hooks } : {}),
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
    const local = await git(workingDirectory, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
    const remote = !local.ok && (await git(workingDirectory, ["show-ref", "--verify", "--quiet", `refs/remotes/${name}`])).ok;
    // A branch deleted since the menu loaded must fail, never become a
    // same-named path checkout that silently discards working-tree edits.
    // A remote branch becomes a local one that tracks it.
    const result = await git(workingDirectory, remote ? ["checkout", "--track", name, "--"] : ["checkout", name, "--"]);
    if (result.ok) return { ok: true, detail: `Checked out ${remote ? name.slice(name.indexOf("/") + 1) : name}.` };
    return { ok: false, detail: checkoutFailure(name, result.stderr || result.stdout) };

  });
}

/** Git's answer, or a sentence for the refusal a branch picker meets most. */
export function checkoutFailure(branch: string, output: string): string {
  const elsewhere = output.match(/(?:is already (?:used by worktree|checked out) at) '([^']+)'/);
  if (elsewhere) return `${branch} is checked out in another worktree, at ${elsewhere[1]}. Open that folder to work on it, or pick another branch.`;
  return output.trim() || "Checkout failed.";
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

/** A commit runs hooks that can take minutes; thirty seconds stopped real ones. */
export const COMMIT_TIMEOUT = 10 * 60_000;

/**
 * Commits what the caller chose and nothing else. `staged` takes the index
 * exactly as Review left it. `paths` takes every change to those files,
 * untracked ones included, with `git commit --only` semantics: anything else
 * already staged stays staged and out of this commit.
 */
export async function commitChanges(
  workingDirectory: string,
  message: string,
  scope: GitCommitScope,
  options: { timeout?: number; } = {},
): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const text = message.trim();
    if (!text) return { ok: false, detail: "Commit message is empty." };
    const timeout = options.timeout ?? COMMIT_TIMEOUT;
    const hooks = await readClientHooks(workingDirectory);
    const hook = hooks.find((name) => name !== "pre-push");
    if (!("paths" in scope)) {
      const staged = await git(workingDirectory, ["diff", "--cached", "--quiet"]);
      if (staged.ok) return { ok: false, detail: "Nothing is staged. Choose the files to commit." };
      if (staged.exitCode !== 1) return { ok: false, detail: staged.stderr || "Could not read what is staged." };
      const result = await git(workingDirectory, ["commit", "-m", text], process.env, timeout);
      if (result.ok) return { ok: true, detail: result.stdout.trim() || "Committed." };
      return { ok: false, detail: commitFailure(result, hook) };
    }
    const paths = [...new Set(scope.paths.filter((item) => item.trim()))];
    if (paths.length === 0) return { ok: false, detail: "Choose at least one file to commit." };
    const before = await git(workingDirectory, ["--literal-pathspecs", "diff", "--cached", "--name-only", "-z", "--", ...paths]);
    const alreadyStaged = new Set(before.stdout.split("\0").filter(Boolean));
    const added = await git(workingDirectory, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
    if (!added.ok) return { ok: false, detail: added.stderr || "Stage failed; nothing committed." };
    const result = await git(workingDirectory, ["--literal-pathspecs", "commit", "--only", "-m", text, "--", ...paths], process.env, timeout);
    if (result.ok) {
      // --only runs hooks on a temporary index; a hook's own `git add` reached the commit but not the real index.
      await git(workingDirectory, ["--literal-pathspecs", "reset", "-q", "HEAD", "--", ...paths]);
      return { ok: true, detail: result.stdout.trim() || "Committed." };
    }
    // Leave the index as it was, so a retry after fixing what a hook flagged takes the fix too.
    const unstage = paths.filter((item) => !alreadyStaged.has(item));
    if (unstage.length) await git(workingDirectory, ["--literal-pathspecs", "reset", "-q", "--", ...unstage]);
    return { ok: false, detail: commitFailure(result, hook) };

  });
}

function commitFailure(result: { stdout: string; stderr: string; }, hook: string | undefined): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  return hookFailure(output, hook, "commit") ?? (output || "Commit failed.");
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

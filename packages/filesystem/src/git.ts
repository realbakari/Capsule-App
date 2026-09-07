import { inRepository } from "./git-process.js";
import fs from "node:fs";
import { lstat, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { GitChange, GitStatus } from "@capsule/shared";
import { git } from "./git-process.js";
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
    const result = await git(workingDirectory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (!result.ok) throw new Error(result.stderr || "Could not read Git status.");
    const porcelain = result.stdout;
    const files = await applyLineStats(workingDirectory, parsePorcelain(porcelain));
    const added = sumStat(files, "added");
    const removed = sumStat(files, "removed");
    const branches = (await git(workingDirectory, ["branch", "--format=%(refname:short)"]))
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
 * `git status --porcelain` says which files changed but not by how much.
 * A single `--numstat` covering both staged and unstaged work is one extra
 * process for the whole tree, rather than a diff per file.
 */
async function applyLineStats(workingDirectory: string, files: GitChange[]): Promise<GitChange[]> {
  if (files.length === 0) return files;
  const stats = new Map<string, { added: number; removed: number; }>();
  const hasHead = (await git(workingDirectory, ["rev-parse", "--verify", "HEAD"])).ok;
  if (hasHead) {
    const out = await git(workingDirectory, ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "HEAD"]);
    if (!out.ok) throw new Error(out.stderr || "Could not read changed-line counts.");
    for (const entry of parseNumstat(out.stdout)) {
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
        if (info.isFile() && info.size <= 1_000_000) {
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

function sumStat(files: GitChange[], key: "added" | "removed"): number | undefined {
  const counted = files.filter((file) => typeof file[key] === "number");
  if (counted.length === 0) return undefined;
  return counted.reduce((total, file) => total + (file[key] ?? 0), 0);
}

export async function checkoutBranch(workingDirectory: string, branch: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const name = branch.trim();
    if (!name || name.startsWith("-")) return { ok: false, detail: "Choose a valid branch name." };
    const result = await git(workingDirectory, ["checkout", name]);
    if (result.ok) return { ok: true, detail: `Checked out ${name}.` };
    return { ok: false, detail: result.stderr || result.stdout || "Checkout failed." };

  });
}

export async function readGitDiff(workingDirectory: string, relative?: string): Promise<string> {
  return inRepository(workingDirectory, async () => {

    const paths = relative ? ["--", relative] : [];
    const hasHead = (await git(workingDirectory, ["rev-parse", "--verify", "HEAD"])).ok;
    const result = hasHead
      ? await git(workingDirectory, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "HEAD", ...paths])
      : { ok: true, stdout: "", stderr: "" };
    if (!result.ok) throw new Error(result.stderr || "Could not read the combined working-tree diff.");
    const listing = await git(workingDirectory, ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", ...(!hasHead ? ["--cached"] : []), ...paths]);
    if (!listing.ok) throw new Error(listing.stderr || "Could not read untracked files.");
    const names = [...new Set(listing.stdout.split("\0").filter(Boolean))];
    if (names.length > 200) throw new Error("More than 200 new files need review. Select individual files to inspect them before committing.");
    const patches = [result.stdout];
    let bytes = Buffer.byteLength(result.stdout);
    for (let offset = 0; offset < names.length; offset += 8) {
      const batch = await Promise.all(names.slice(offset, offset + 8).map(async (name) => {
        const info = await lstat(path.join(workingDirectory, name)).catch(() => undefined);
        if (!info) return ""; // Deleted before the first commit.
        if (!info.isFile() && !info.isSymbolicLink()) return "";
        if (info.size > 1_000_000) throw new Error(`New file ${name} is too large to review here. Inspect it before committing.`);
        const patch = await git(workingDirectory, ["--literal-pathspecs", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--", "/dev/null", name]);
        // --no-index exits 1 when files differ, which is its successful result.
        if (!patch.stdout.startsWith("diff --git ")) throw new Error(patch.stderr || `Could not review ${name}.`);
        return patch.stdout;
      }));
      for (const patch of batch) {
        bytes += Buffer.byteLength(patch);
        if (bytes > 16 * 1024 * 1024) throw new Error("The combined diff exceeds 16 MB. Review individual files before committing.");
        patches.push(patch);
      }
    }
    return patches.join("");

  }, JSON.stringify(["readGitDiff", workingDirectory, relative]));
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

import { inRepository } from "./git-process.js";
import fs from "node:fs";
import { readFile, lstat, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { GitChange, GitStatus } from "@capsule/shared";
import { git } from "./git-process.js";

function parsePorcelain(text: string): GitChange[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim() || line[0] || "?";
      const rest = line.slice(3);
      const filePath = rest.includes(" -> ") ? rest.split(" -> ").pop() ?? rest : rest;
      return { path: filePath, code };
    });
}

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
    const result = await git(workingDirectory, ["status", "--porcelain"]);
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
  for (const args of [["diff", "--numstat"], ["diff", "--numstat", "--cached"]]) {
    const out = await git(workingDirectory, args);
    if (!out.ok) continue;
    for (const line of out.stdout.split(/\r?\n/)) {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
      if (!match) continue;
      const [, addedRaw, removedRaw, rawPath] = match;
      // "-" marks a binary file: countable lines do not apply.
      if (addedRaw === "-" || removedRaw === "-") continue;
      const key = rawPath!.trim();
      const prev = stats.get(key) ?? { added: 0, removed: 0 };
      stats.set(key, {
        added: prev.added + Number(addedRaw),
        removed: prev.removed + Number(removedRaw),
      });
    }
  }
  const countFile = async (file: GitChange): Promise<GitChange> => {
    const stat = stats.get(file.path);
    if (stat) return { ...file, added: stat.added, removed: stat.removed };
    if (file.code.includes("?")) {
      try {
        const fullPath = path.join(workingDirectory, file.path);
        const info = await lstat(fullPath);
        if (info.isFile() && info.size <= 1_000_000) {
          const content = await readFile(fullPath, "utf8");
          if (content.includes("\0")) return file;
          const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
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

    const args = relative ? ["diff", "--", relative] : ["diff"];
    const result = await git(workingDirectory, args);
    if (!result.ok) throw new Error(result.stderr || "Could not read diff.");
    if (result.stdout.trim()) return result.stdout;
    const staged = await git(workingDirectory, relative ? ["diff", "--cached", "--", relative] : ["diff", "--cached"]);
    if (!staged.ok) throw new Error(staged.stderr || "Could not read staged diff.");
    return staged.stdout;

  }, JSON.stringify(["readGitDiff", workingDirectory, relative]));
}

export async function stageFile(workingDirectory: string, relative: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const result = await git(workingDirectory, ["add", "--", relative]);
    if (result.ok) return { ok: true, detail: `Staged ${relative}.` };
    return { ok: false, detail: result.stderr || "Stage failed." };

  });
}

export async function discardFile(workingDirectory: string, relative: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(workingDirectory, async () => {

    const restored = await git(workingDirectory, ["restore", "--worktree", "--source=HEAD", "--", relative]);
    if (restored.ok) return { ok: true, detail: `Restored ${relative}.` };
    const checked = await git(workingDirectory, ["checkout", "--", relative]);
    if (checked.ok) return { ok: true, detail: `Restored ${relative}.` };
    const target = path.join(workingDirectory, relative);
    const root = await realpath(workingDirectory);
    const parent = await realpath(path.dirname(target));
    const within = path.relative(root, path.join(parent, path.basename(target)));
    const untracked = await git(workingDirectory, ["ls-files", "--others", "--exclude-standard", "-z", "--", relative]);
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

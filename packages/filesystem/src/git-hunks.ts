import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitDiffOptions, GitDiffScope, HunkApply, PatchApplication, ScopedDiff } from "@capsule/shared";
import { git, inRepository } from "./git-process.js";
import { readCommitPatch, readReviewPatch, readWorkingTreePatch, reviewBase } from "./review-diff.js";

export async function readScopedDiff(cwd: string, scope: GitDiffScope, relative?: string, options: GitDiffOptions = {}): Promise<ScopedDiff> {
  const read = { ignoreWhitespace: options.ignoreWhitespace };
  return inRepository(cwd, async () => {
    const result = await (async (): Promise<ScopedDiff> => {
      if (scope === "uncommitted") return readWorkingTreePatch(cwd, relative, options);
      if (scope === "staged") return readReviewPatch(cwd, ["--cached"], relative, { ...read, untracked: false });
      if (scope === "unstaged") return readReviewPatch(cwd, [], relative, { ...read, untracked: true });
      if (scope === "commit") return readCommitPatch(cwd, options.commit ?? "", relative, options);
      const base = await reviewBase(cwd, options.base);
      if (!base) throw new Error(options.base ? `${options.base} no longer exists, and no default branch was found to compare against.` : "No default branch was found. Choose a branch to compare against.");
      const mergeBase = await git(cwd, ["merge-base", "--end-of-options", base, "HEAD"]);
      if (!mergeBase.ok) throw new Error(`This branch shares no history with ${base}.`);
      return { base, ...await readReviewPatch(cwd, [mergeBase.stdout.trim()], relative, { ...read, untracked: true }) };
    })();
    return { patch: result.patch, ...(result.base ? { base: result.base } : {}), ...(result.omitted?.length ? { omitted: result.omitted } : {}) };
  }, JSON.stringify(["readScopedDiff", cwd, scope, relative, Boolean(options.ignoreWhitespace), options.base ?? "", options.commit ?? ""]));
}

type Target = "index" | "worktree";

function applyArgs(target: Target, part: PatchApplication, file: string, check: boolean): string[] {
  return ["apply", "--whitespace=nowarn", ...(target === "index" ? ["--cached"] : []), ...(part.reverse ? ["--reverse"] : []), ...(check ? ["--check"] : []), file];
}

/** Git's own words, without the "error: " prefix on every line. */
function gitError(stderr: string): string {
  return stderr.split("\n").map((line) => line.replace(/^error: /, "")).filter(Boolean).join("\n") || "Git could not apply this change.";
}

async function withPatchFiles<T>(apply: HunkApply, run: (parts: Array<[Target, PatchApplication, string]>) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(path.join(tmpdir(), "capsule-hunk-"));
  try {
    const parts: Array<[Target, PatchApplication, string]> = [];
    for (const target of ["index", "worktree"] as const) {
      const part = apply[target];
      if (!part) continue;
      const file = path.join(folder, `${target}.patch`);
      await writeFile(file, part.patch);
      parts.push([target, part, file]);
    }
    return await run(parts);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function check(cwd: string, parts: Array<[Target, PatchApplication, string]>): Promise<string | undefined> {
  for (const [target, part, file] of parts) {
    const result = await git(cwd, applyArgs(target, part, file, true));
    if (!result.ok) return gitError(result.stderr);
  }
  return undefined;
}

/**
 * Apply one Review action. Every part is checked before any is applied, and
 * the index is put back if the working tree then refuses, so a stale hunk
 * leaves the repository exactly as it was.
 */
export async function applyHunk(cwd: string, apply: HunkApply): Promise<{ ok: boolean; detail: string }> {
  return inRepository(cwd, () => withPatchFiles(apply, async (parts) => {
    if (parts.length === 0) return { ok: false, detail: "Nothing to apply." };
    const refused = await check(cwd, parts);
    if (refused) return { ok: false, detail: refused };
    const done: Array<[Target, PatchApplication, string]> = [];
    for (const [target, part, file] of parts) {
      const result = await git(cwd, applyArgs(target, part, file, false));
      if (!result.ok) {
        for (const [undoTarget, undoPart, undoFile] of done.reverse()) {
          await git(cwd, applyArgs(undoTarget, { ...undoPart, reverse: !undoPart.reverse }, undoFile, false));
        }
        return { ok: false, detail: gitError(result.stderr) };
      }
      done.push([target, part, file]);
    }
    return { ok: true, detail: "Applied." };
  }));
}

/** Whether each action would still apply, without changing anything. */
export async function checkHunks(cwd: string, applies: readonly HunkApply[]): Promise<boolean[]> {
  return inRepository(cwd, async () => {
    const results: boolean[] = [];
    for (const apply of applies) {
      results.push(await withPatchFiles(apply, async (parts) => parts.length > 0 && !(await check(cwd, parts))));
    }
    return results;
  }, JSON.stringify(["checkHunks", cwd, applies]));
}

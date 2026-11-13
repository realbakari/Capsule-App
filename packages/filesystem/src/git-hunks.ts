import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitDiffScope, HunkApply, PatchApplication, ScopedDiff } from "@capsule/shared";
import { git, inRepository } from "./git-process.js";
import { CANONICAL_PATCH_FLAGS } from "./git-output.js";
import { readGitDiff, readUntrackedPatches, REVIEW_DIFF_BYTES } from "./git.js";

const DIFF = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", ...CANONICAL_PATCH_FLAGS];

async function diffText(cwd: string, args: string[], relative: string | undefined, what: string): Promise<string> {
  const result = await git(cwd, [...DIFF, ...args, "--", ...(relative ? [relative] : [])]);
  if (!result.ok) throw new Error(result.stderr || `Could not read the ${what} diff.`);
  return result.stdout;
}

/*
 * The branch work started from: where origin/HEAD points, else a local main
 * or master. A local branch wins over its remote copy, because a worktree
 * conversation branches from the local one.
 */
async function defaultBranch(cwd: string): Promise<string | undefined> {
  const remoteHead = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const remoteName = remoteHead.ok ? remoteHead.stdout.trim() : "";
  const local = remoteName.replace(/^origin\//, "");
  const candidates = [...(local ? [local, remoteName] : []), "main", "master", "origin/main", "origin/master"];
  for (const name of candidates) {
    if ((await git(cwd, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`])).ok) return name;
  }
  return undefined;
}

export async function readScopedDiff(cwd: string, scope: GitDiffScope, relative?: string): Promise<ScopedDiff> {
  return inRepository(cwd, async () => {
    if (scope === "uncommitted") return { patch: await readGitDiff(cwd, relative) };
    if (scope === "staged") return { patch: await diffText(cwd, ["--cached"], relative, "staged") };
    if (scope === "unstaged") {
      const tracked = await diffText(cwd, [], relative, "unstaged");
      return { patch: tracked + await readUntrackedPatches(cwd, relative, false, REVIEW_DIFF_BYTES - Buffer.byteLength(tracked)) };
    }
    const base = await defaultBranch(cwd);
    if (!base) throw new Error("No default branch was found. Branch compares against main, master, or the remote's default branch.");
    const mergeBase = await git(cwd, ["merge-base", base, "HEAD"]);
    if (!mergeBase.ok) throw new Error(`This branch shares no history with ${base}.`);
    const tracked = await diffText(cwd, [mergeBase.stdout.trim()], relative, "branch");
    return { base, patch: tracked + await readUntrackedPatches(cwd, relative, false, REVIEW_DIFF_BYTES - Buffer.byteLength(tracked)) };
  }, JSON.stringify(["readScopedDiff", cwd, scope, relative]));
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

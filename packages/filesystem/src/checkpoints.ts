import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-turn workspace checkpoints, stored as hidden Git refs.
 *
 * The changed-files card diffs the working tree against HEAD, which blends
 * whatever the agent just did with edits the user made themselves and cannot be
 * scoped to one turn. A checkpoint captures the whole worktree at the end of a
 * turn, so two consecutive checkpoints bound exactly what that turn changed,
 * and restoring one puts the worktree back.
 *
 * Three properties matter, and each comes from a specific piece of plumbing:
 *
 *  - The user's staging area is never touched. `git add -A` runs against a
 *    throwaway index pointed at by GIT_INDEX_FILE, so a half-staged change the
 *    user was in the middle of survives untouched.
 *  - The commit is on no branch. `commit-tree` writes a parentless commit that
 *    appears in no history and no `git log`.
 *  - It still survives gc. The ref lives under refs/capsule/, outside
 *    refs/heads and refs/tags, so it never shows in branch or tag lists but
 *    still roots the commit.
 */

const REF_ROOT = "refs/capsule/checkpoints";
const GIT_TIMEOUT_MS = 10_000;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    env: env ?? process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Ref for one turn. Session and turn are sanitised because they land in a ref
 * name: git rejects several characters outright, and a crafted title must not
 * be able to reach outside the checkpoint namespace.
 */
export function checkpointRef(sessionId: string, turn: number): string {
  const safeSession = sessionId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "session";
  const safeTurn = Number.isFinite(turn) && turn >= 0 ? Math.floor(turn) : 0;
  return `${REF_ROOT}/${safeSession}/turn/${safeTurn}`;
}

export function isGitRepository(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

/** The real .git directory, which is not cwd/.git inside a worktree. */
function gitCommonDir(cwd: string): string | undefined {
  const result = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!result.ok) return undefined;
  const dir = result.stdout.trim();
  if (!dir) return undefined;
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

function hasHead(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--verify", "HEAD"]).ok;
}

/**
 * Capture the current worktree at `ref`. Safe to call on a repository with no
 * commits yet, and a no-op result rather than a throw when cwd is not a repo.
 */
export function captureCheckpoint(cwd: string, ref: string): { ok: boolean; detail: string } {
  if (!isGitRepository(cwd)) return { ok: false, detail: "Not a Git repository." };
  const commonDir = gitCommonDir(cwd);
  if (!commonDir) return { ok: false, detail: "Could not resolve the Git directory." };

  const tempIndex = path.join(commonDir, `capsule-checkpoint-index-${randomUUID()}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_INDEX_FILE: tempIndex,
    // A checkpoint is Capsule's bookkeeping, not the user's authorship.
    GIT_AUTHOR_NAME: "Capsule",
    GIT_AUTHOR_EMAIL: "capsule@localhost",
    GIT_COMMITTER_NAME: "Capsule",
    GIT_COMMITTER_EMAIL: "capsule@localhost",
  };

  try {
    if (hasHead(cwd)) {
      const seeded = git(cwd, ["read-tree", "HEAD"], env);
      if (!seeded.ok) return { ok: false, detail: seeded.stderr || "read-tree failed." };
    }

    const staged = git(cwd, ["add", "-A", "--", "."], env);
    if (!staged.ok) return { ok: false, detail: staged.stderr || "add failed." };

    const tree = git(cwd, ["write-tree"], env);
    const treeOid = tree.stdout.trim();
    if (!tree.ok || !treeOid) return { ok: false, detail: tree.stderr || "write-tree failed." };

    const commit = git(cwd, ["commit-tree", treeOid, "-m", `capsule checkpoint ${ref}`], env);
    const commitOid = commit.stdout.trim();
    if (!commit.ok || !commitOid) {
      return { ok: false, detail: commit.stderr || "commit-tree failed." };
    }

    const updated = git(cwd, ["update-ref", ref, commitOid]);
    if (!updated.ok) return { ok: false, detail: updated.stderr || "update-ref failed." };
    return { ok: true, detail: commitOid };
  } finally {
    try {
      fs.rmSync(tempIndex, { force: true });
    } catch {
      // A leftover index costs a few kilobytes; it must not fail the turn.
    }
  }
}

export function hasCheckpoint(cwd: string, ref: string): boolean {
  return git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]).ok;
}

/**
 * Diff two checkpoints. With only `to`, diffs that checkpoint against the
 * current worktree, which is how "what changed since this turn" is asked.
 */
export function diffCheckpoints(
  cwd: string,
  to: string,
  from?: string,
  options?: { ignoreWhitespace?: boolean; relative?: string },
): string {
  if (!hasCheckpoint(cwd, to)) return "";
  const args = ["diff"];
  if (options?.ignoreWhitespace) args.push("-w");
  if (from && hasCheckpoint(cwd, from)) args.push(from, to);
  else args.push(to);
  if (options?.relative) args.push("--", options.relative);
  const result = git(cwd, args);
  return result.ok ? result.stdout : "";
}

/** Files touched between two checkpoints, as `git diff --numstat` rows. */
export function checkpointNumstat(
  cwd: string,
  to: string,
  from?: string,
): Array<{ path: string; added: number; removed: number }> {
  if (!hasCheckpoint(cwd, to)) return [];
  const args = ["diff", "--numstat"];
  if (from && hasCheckpoint(cwd, from)) args.push(from, to);
  else args.push(to);
  const result = git(cwd, args);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [added, removed, file] = line.split("\t");
      return {
        path: file ?? "",
        // "-" is git's marker for a binary file, not a count.
        added: added === "-" ? 0 : Number(added ?? 0),
        removed: removed === "-" ? 0 : Number(removed ?? 0),
      };
    })
    .filter((entry) => entry.path.length > 0);
}

/**
 * Restore the worktree to a checkpoint.
 *
 * `git checkout <ref> -- .` reinstates every file the checkpoint holds but
 * cannot remove one created afterwards. Those have to be found by comparing the
 * checkpoint's file list against the worktree's, and specifically not with
 * `git diff <ref>`: a file created after the checkpoint is untracked, and diff
 * against a ref only reports tracked paths, so it never appears.
 *
 * The worktree listing uses --exclude-standard, so ignored files are left
 * alone — `add -A` honoured .gitignore when the checkpoint was captured, so
 * they were never in it to begin with and are not the agent's doing.
 */
export function restoreCheckpoint(cwd: string, ref: string): { ok: boolean; detail: string } {
  if (!isGitRepository(cwd)) return { ok: false, detail: "Not a Git repository." };
  if (!hasCheckpoint(cwd, ref)) return { ok: false, detail: "That checkpoint no longer exists." };

  const lines = (result: GitResult): string[] =>
    result.ok
      ? result.stdout.split("\n").map((value) => value.trim()).filter(Boolean)
      : [];

  const inCheckpoint = new Set(lines(git(cwd, ["ls-tree", "-r", "--name-only", ref])));
  const inWorktree = lines(
    git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]),
  );

  const restored = git(cwd, ["checkout", ref, "--", "."]);
  if (!restored.ok) return { ok: false, detail: restored.stderr || "checkout failed." };

  let removed = 0;
  for (const relative of inWorktree) {
    if (inCheckpoint.has(relative)) continue;
    try {
      fs.rmSync(path.resolve(cwd, relative), { force: true });
      removed += 1;
    } catch {
      // Surfaced by the next status read rather than aborting a partial restore.
    }
  }
  return {
    ok: true,
    detail: removed > 0 ? `Restored, removing ${removed} newer file(s).` : "Restored.",
  };
}

/** Drop every checkpoint for a session, e.g. when its thread is deleted. */
export function deleteCheckpoints(cwd: string, sessionId: string): number {
  if (!isGitRepository(cwd)) return 0;
  const prefix = checkpointRef(sessionId, 0).replace(/\/turn\/0$/, "");
  const listed = git(cwd, ["for-each-ref", "--format=%(refname)", prefix]);
  if (!listed.ok) return 0;
  const refs = listed.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
  let removed = 0;
  for (const ref of refs) {
    if (git(cwd, ["update-ref", "-d", ref]).ok) removed += 1;
  }
  return removed;
}

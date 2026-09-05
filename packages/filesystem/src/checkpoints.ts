import { inRepository } from "./git-process.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./git-process.js";
import type { WorkspaceRevision } from "@capsule/shared";

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

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
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

export async function isGitRepository(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).stdout.trim() === "true";
}

/** The real .git directory, which is not cwd/.git inside a worktree. */
async function gitCommonDir(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!result.ok) return undefined;
  const dir = result.stdout.trim();
  if (!dir) return undefined;
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

/**
 * Capture the current worktree at `ref`. Safe to call on a repository with no
 * commits yet, and a no-op result rather than a throw when cwd is not a repo.
 */
export async function captureCheckpoint(cwd: string, ref: string): Promise<{ ok: boolean; detail: string; revision?: WorkspaceRevision; }> {
  return inRepository(cwd, async () => {
    try {
      const revision = await readWorktreeRevision(cwd);
      const env = { ...process.env, GIT_AUTHOR_NAME: "Capsule", GIT_AUTHOR_EMAIL: "capsule@localhost", GIT_COMMITTER_NAME: "Capsule", GIT_COMMITTER_EMAIL: "capsule@localhost" };
      const commit = await git(cwd, ["commit-tree", revision.tree, "-m", `capsule checkpoint ${ref}`], env);
      if (!commit.ok) return { ok: false, detail: commit.stderr };
      const updated = await git(cwd, ["update-ref", ref, commit.stdout.trim()]);
      return { ok: updated.ok, detail: updated.ok ? commit.stdout.trim() : updated.stderr, revision };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Includes staged, unstaged and untracked (not ignored) files, without touching the user's index. */
export async function readWorktreeRevision(cwd: string): Promise<WorkspaceRevision> {
  return inRepository(cwd, async () => {
    if (!(await isGitRepository(cwd))) throw new Error("Not a Git repository.");
    const commonDir = await gitCommonDir(cwd);
    if (!commonDir) throw new Error("Could not resolve the Git directory.");

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
      const headResult = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
      const head = headResult.ok ? headResult.stdout.trim() : null;
      if (head) {
        const seeded = await git(cwd, ["read-tree", head], env);
        if (!seeded.ok) throw new Error(seeded.stderr || "read-tree failed.");
      }

      const staged = await git(cwd, ["add", "-A", "--", "."], env);
      if (!staged.ok) throw new Error(staged.stderr || "add failed.");

      const tree = await git(cwd, ["write-tree"], env);
      const treeOid = tree.stdout.trim();
      if (!tree.ok || !treeOid) throw new Error(tree.stderr || "write-tree failed.");
      const afterHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
      if (head !== (afterHead.ok ? afterHead.stdout.trim() : null)) throw new Error("HEAD changed while recording the workspace. Retry.");
      return { cwd: await fs.realpath(cwd), head, tree: treeOid };
    } finally {
      try {
        await fs.rm(tempIndex, { force: true });
      } catch {
        // A leftover index costs a few kilobytes; it must not fail the turn.
      }
    }

  });
}

export async function hasCheckpoint(cwd: string, ref: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).ok;
}

/**
 * Diff two checkpoints. With only `to`, diffs that checkpoint against the
 * current worktree, which is how "what changed since this turn" is asked.
 */
export async function diffCheckpoints(
  cwd: string,
  to: string,
  from?: string,
  options?: { ignoreWhitespace?: boolean; relative?: string; },
): Promise<string> {
  return inRepository(cwd, async () => {

    if (!(await hasCheckpoint(cwd, to))) return "";
    const args = ["diff"];
    if (options?.ignoreWhitespace) args.push("-w");
    if (from && (await hasCheckpoint(cwd, from))) args.push(from, to);
    else args.push(to);
    if (options?.relative) args.push("--", options.relative);
    const result = await git(cwd, args);
    return result.ok ? result.stdout : "";

  }, JSON.stringify(["diffCheckpoints", cwd, to, from, options]));
}

/** Files touched between two checkpoints, as `git diff --numstat` rows. */
export async function checkpointNumstat(
  cwd: string,
  to: string,
  from?: string,
): Promise<Array<{ path: string; added: number; removed: number; }>> {
  return inRepository(cwd, async () => {

    if (!(await hasCheckpoint(cwd, to))) return [];
    const args = ["diff", "--numstat"];
    if (from && (await hasCheckpoint(cwd, from))) args.push(from, to);
    else args.push(to);
    const result = await git(cwd, args);
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

  }, JSON.stringify(["checkpointNumstat", cwd, to, from]));
}

/**
 * Restore the worktree to a checkpoint.
 *
 * Seed a private index from the current worktree, including untracked files,
 * then let Git restore only the worktree from the checkpoint. Git handles
 * unusual filenames, deletions and directory/file transitions; the user's
 * real index is never opened for writing. Ignored files remain untouched.
 */
export async function restoreCheckpoint(cwd: string, ref: string): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(cwd, async () => {

    if (!(await isGitRepository(cwd))) return { ok: false, detail: "Not a Git repository." };
    if (!(await hasCheckpoint(cwd, ref))) return { ok: false, detail: "That checkpoint no longer exists." };

    const commonDir = await gitCommonDir(cwd);
    if (!commonDir) return { ok: false, detail: "Could not resolve the Git directory." };
    const tempIndex = path.join(commonDir, `capsule-restore-index-${randomUUID()}`);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    try {
      const current = await readWorktreeRevision(cwd);
      const target = await git(cwd, ["rev-parse", `${ref}^{tree}`]);
      if (!target.ok) return { ok: false, detail: target.stderr };
      if (current.tree === target.stdout.trim()) return { ok: true, detail: "The folder already matches this turn." };
      const seeded = await git(cwd, ["read-tree", current.tree], env);
      if (!seeded.ok) return { ok: false, detail: seeded.stderr };
      const restored = await git(cwd, ["restore", "--source", ref, "--worktree", "--", "."], env);
      return { ok: restored.ok, detail: restored.ok ? "Restored the folder. Staged changes were left untouched." : restored.stderr || "Restore failed; inspect the folder before retrying." };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    } finally {
      await fs.rm(tempIndex, { force: true }).catch(() => undefined);
    }

  });
}

/** Drop every checkpoint for a session, e.g. when its thread is deleted. */
export async function deleteCheckpoints(cwd: string, sessionId: string): Promise<number> {
  return inRepository(cwd, async () => {

    if (!(await isGitRepository(cwd))) return 0;
    const prefix = checkpointRef(sessionId, 0).replace(/\/turn\/0$/, "");
    const listed = await git(cwd, ["for-each-ref", "--format=%(refname)", prefix]);
    if (!listed.ok) return 0;
    const refs = listed.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
    let removed = 0;
    for (const ref of refs) {
      if ((await git(cwd, ["update-ref", "-d", ref])).ok) removed += 1;
    }
    return removed;

  });
}

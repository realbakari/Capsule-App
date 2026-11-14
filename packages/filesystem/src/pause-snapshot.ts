import fs from "node:fs";
import path from "node:path";
import { git, inRepository } from "./git-process.js";
import { checkpointGit } from "./checkpoint-retry.js";
import { deleteCheckpointRef, hasCheckpoint, readWorktreeRevision } from "./checkpoints.js";

/**
 * Pausing a worktree thread saves its work to a hidden ref instead of a commit
 * on its branch.
 *
 * A WIP commit would sit on the very branch an open pull request is built
 * from: one push, by the user or a watch-and-fix turn, publishes it, and
 * unwinding it on resume means a reset that can drop whatever landed on the
 * branch meanwhile. The ref changes no branch, no file and no staging area.
 * It holds two commits, so resume can put back both halves exactly:
 *
 *  - the snapshot commit, whose tree is the folder as it stood (staged,
 *    unstaged and untracked files; ignored files are left alone), and
 *  - its second parent, whose tree is the staging area as it stood.
 */

const BOOKKEEPING = {
  GIT_AUTHOR_NAME: "Capsule",
  GIT_AUTHOR_EMAIL: "capsule@localhost",
  GIT_COMMITTER_NAME: "Capsule",
  GIT_COMMITTER_EMAIL: "capsule@localhost",
};

export interface PausedWorktree {
  ref: string;
  /** The branch tip when the thread paused; null on a branch with no commits. */
  head: string | null;
  /** The folder's tree, untracked files included. */
  tree: string;
  /** The staging area's tree. */
  index: string;
}

export type ResumeOutcome =
  /** The folder still matched the snapshot. */
  | "unchanged"
  /** The folder had lost the paused work, or was gone, and the snapshot put it back. */
  | "restored"
  /** The folder changed in other ways while paused; it was left as it is and the snapshot kept. */
  | "kept";

export async function savePausedWorktree(cwd: string, ref: string): Promise<{ ok: true; paused: PausedWorktree } | { ok: false; detail: string }> {
  return inRepository(cwd, async () => {
    try {
      const env = { ...process.env, ...BOOKKEEPING };
      const index = await git(cwd, ["write-tree"]);
      if (!index.ok) return { ok: false, detail: index.stderr.includes("unmerged") ? "Finish or abort the merge in this worktree before pausing." : index.stderr || "Could not read the staging area." };
      const revision = await readWorktreeRevision(cwd);
      const parent = revision.head ? ["-p", revision.head] : [];
      const indexCommit = await git(cwd, ["commit-tree", index.stdout.trim(), ...parent, "-m", "capsule paused staging area"], env);
      if (!indexCommit.ok) return { ok: false, detail: indexCommit.stderr };
      const snapshot = await git(cwd, ["commit-tree", revision.tree, ...parent, "-p", indexCommit.stdout.trim(), "-m", "capsule paused thread"], env);
      if (!snapshot.ok) return { ok: false, detail: snapshot.stderr };
      const saved = await checkpointGit(cwd, ["update-ref", ref, snapshot.stdout.trim()]);
      if (!saved.ok) return { ok: false, detail: saved.stderr };
      return { ok: true, paused: { ref, head: revision.head, tree: revision.tree, index: index.stdout.trim() } };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Put a paused worktree back. Never overwrites work it did not save: if the
 * folder changed while paused (new commits, new edits), it is left alone and
 * the snapshot stays at its ref for the user to recover by hand.
 *
 * `recreate` brings back a folder that was removed while paused, on its branch.
 */
export async function restorePausedWorktree(
  cwd: string,
  ref: string,
  recreate?: { repository: string; branch: string },
): Promise<{ ok: true; outcome: ResumeOutcome; detail: string } | { ok: false; detail: string }> {
  const missing = !fs.existsSync(cwd) || fs.readdirSync(cwd).length === 0;
  if (missing) {
    if (!recreate) return { ok: false, detail: "The worktree folder is gone." };
    if (!(await hasCheckpoint(recreate.repository, ref))) return { ok: false, detail: "The paused snapshot no longer exists." };
    const back = await inRepository(recreate.repository, async () => {
      await git(recreate.repository, ["worktree", "prune"]);
      fs.mkdirSync(path.dirname(cwd), { recursive: true });
      return git(recreate.repository, ["worktree", "add", cwd, recreate.branch]);
    });
    if (!back.ok) return { ok: false, detail: back.stderr || "Could not recreate the worktree." };
  }
  return inRepository(cwd, async () => {
    try {
      if (!(await hasCheckpoint(cwd, ref))) return { ok: false, detail: "The paused snapshot no longer exists." };
      const read = async (spec: string) => {
        const result = await git(cwd, ["rev-parse", "--verify", spec]);
        return result.ok ? result.stdout.trim() : undefined;
      };
      const tree = await read(`${ref}^{tree}`);
      const index = await read(`${ref}^2^{tree}`);
      const head = await read(`${ref}^1`) ?? null;
      if (!tree || !index) return { ok: false, detail: "The paused snapshot is incomplete." };
      const current = await readWorktreeRevision(cwd);
      if (current.tree === tree) {
        await deleteCheckpointRef(cwd, ref);
        return { ok: true, outcome: "unchanged", detail: "The worktree is as you left it." };
      }
      const headTree = current.head ? await read(`${current.head}^{tree}`) : await emptyTree(cwd);
      if (current.head !== head || current.tree !== headTree) {
        return { ok: true, outcome: "kept", detail: `The worktree changed while paused, so it was left as it is. The paused work is kept at ${ref}.` };
      }
      const files = await git(cwd, ["read-tree", "--reset", "-u", tree]);
      if (!files.ok) return { ok: false, detail: files.stderr || "Could not restore the paused files." };
      const staged = await git(cwd, ["read-tree", index]);
      if (!staged.ok) return { ok: false, detail: `The files are back, but the staging area could not be restored: ${staged.stderr}` };
      if ((await readWorktreeRevision(cwd)).tree !== tree) return { ok: false, detail: `The worktree does not match the paused snapshot. It is kept at ${ref}.` };
      await deleteCheckpointRef(cwd, ref);
      return { ok: true, outcome: "restored", detail: "Restored the paused work." };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
}

async function emptyTree(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ["hash-object", "-t", "tree", "/dev/null"]);
  return result.ok ? result.stdout.trim() : undefined;
}

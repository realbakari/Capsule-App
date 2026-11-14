import { inRepository } from "./git-process.js";
import fs from "node:fs";
import path from "node:path";
import { git } from "./git-process.js";
import { captureCheckpoint, deleteCheckpointRef, hasCheckpoint, restoreCheckpoint } from "./checkpoints.js";

export interface WorktreeResult {
  ok: boolean;
  detail: string;
  path?: string;
  branch?: string;
}


export async function createWorktree(
  repository: string,
  destination: string,
  branch: string,
): Promise<WorktreeResult> {
  return inRepository(repository, async () => {

    const root = await git(repository, ["rev-parse", "--show-toplevel"]);
    if (!root.ok || !root.stdout) return { ok: false, detail: "Project is not a Git repository." };
    const head = await git(repository, ["rev-parse", "--verify", "HEAD"]);
    if (!head.ok) {
      return { ok: false, detail: "Create the first Git commit before starting a worktree conversation." };
    }
    if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
      return { ok: false, detail: `Worktree folder is not empty: ${destination}` };
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const added = await git(root.stdout.trim(), ["worktree", "add", "-b", branch, destination, "HEAD"]);
    if (!added.ok) return { ok: false, detail: added.stderr || added.stdout || "Could not create worktree." };
    return { ok: true, detail: `Created ${branch}.`, path: destination, branch };

  });
}

/** Remove only a clean Capsule-created worktree. Dirty work is deliberately retained. */
export async function removeWorktree(repository: string, destination: string): Promise<WorktreeResult> {
  return inRepository(repository, async () => {

    if (!fs.existsSync(destination)) return { ok: true, detail: "Worktree was already removed." };
    const dirty = await git(destination, ["status", "--porcelain"]);
    if (!dirty.ok || dirty.stdout) {
      return {
        ok: false,
        detail: dirty.stdout
          ? `Worktree has uncommitted changes and was kept at ${destination}.`
          : dirty.stderr || `Could not inspect ${destination}.`,
      };
    }
    const removed = await git(repository, ["worktree", "remove", destination]);
    if (!removed.ok) return { ok: false, detail: removed.stderr || "Could not remove worktree." };
    return { ok: true, detail: `Removed worktree ${destination}.` };

  });
}

/**
 * Take a worktree off disk without losing its work: the folder as it stands,
 * untracked files included, is saved at `ref` (a hidden ref in the shared
 * repository), then the folder is removed. The branch stays. `restoreWorktree`
 * reverses it.
 */
export async function setAsideWorktree(repository: string, destination: string, ref: string): Promise<WorktreeResult> {
  return inRepository(repository, async () => {
    if (!fs.existsSync(destination)) return { ok: true, detail: "Worktree was already removed." };
    const saved = await captureCheckpoint(destination, ref);
    if (!saved.ok) return { ok: false, detail: `Could not save the worktree before removing it: ${saved.detail}` };
    const removed = await git(repository, ["worktree", "remove", "--force", destination]);
    if (!removed.ok) return { ok: false, detail: removed.stderr || "Could not remove worktree." };
    return { ok: true, detail: `Saved and removed worktree ${destination}.` };
  });
}

/** Put a set-aside worktree back on its branch, with its saved files. Safe to repeat. */
export async function restoreWorktree(repository: string, destination: string, branch: string, ref: string): Promise<WorktreeResult> {
  return inRepository(repository, async () => {
    if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) return { ok: true, detail: "Worktree is already in place.", path: destination, branch };
    if (!(await hasCheckpoint(repository, ref))) return { ok: false, detail: "The saved copy of this worktree no longer exists." };
    await git(repository, ["worktree", "prune"]);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const added = await git(repository, ["worktree", "add", destination, branch]);
    if (!added.ok) return { ok: false, detail: added.stderr || added.stdout || "Could not recreate the worktree." };
    const restored = await restoreCheckpoint(destination, ref);
    if (!restored.ok) return { ok: false, detail: `The worktree is back on ${branch}, but its saved files could not be restored: ${restored.detail}` };
    await deleteCheckpointRef(repository, ref);
    return { ok: true, detail: `Restored worktree ${destination}.`, path: destination, branch };
  });
}

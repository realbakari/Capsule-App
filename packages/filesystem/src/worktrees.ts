import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface WorktreeResult {
  ok: boolean;
  detail: string;
  path?: string;
  branch?: string;
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function createWorktree(
  repository: string,
  destination: string,
  branch: string,
): WorktreeResult {
  const root = git(repository, ["rev-parse", "--show-toplevel"]);
  if (!root.ok || !root.stdout) return { ok: false, detail: "Project is not a Git repository." };
  const head = git(repository, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) {
    return { ok: false, detail: "Create the first Git commit before starting a worktree conversation." };
  }
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    return { ok: false, detail: `Worktree folder is not empty: ${destination}` };
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const added = git(root.stdout, ["worktree", "add", "-b", branch, destination, "HEAD"]);
  if (!added.ok) return { ok: false, detail: added.stderr || added.stdout || "Could not create worktree." };
  return { ok: true, detail: `Created ${branch}.`, path: destination, branch };
}

/** Remove only a clean Capsule-created worktree. Dirty work is deliberately retained. */
export function removeWorktree(repository: string, destination: string): WorktreeResult {
  if (!fs.existsSync(destination)) return { ok: true, detail: "Worktree was already removed." };
  const dirty = git(destination, ["status", "--porcelain"]);
  if (!dirty.ok || dirty.stdout) {
    return {
      ok: false,
      detail: dirty.stdout
        ? `Worktree has uncommitted changes and was kept at ${destination}.`
        : dirty.stderr || `Could not inspect ${destination}.`,
    };
  }
  const removed = git(repository, ["worktree", "remove", destination]);
  if (!removed.ok) return { ok: false, detail: removed.stderr || "Could not remove worktree." };
  return { ok: true, detail: `Removed worktree ${destination}.` };
}

import { inRepository } from "./git-process.js";
import fs from "node:fs";
import path from "node:path";
import type { GitRefName, WorktreeBaseChoice, WorktreeBases } from "@capsule/shared";
import { git } from "./git-process.js";
import { captureCheckpoint, deleteCheckpointRef, hasCheckpoint, restoreCheckpoint } from "./checkpoints.js";
import { remoteCommandFailure } from "./remote-errors.js";

export interface WorktreeResult {
  ok: boolean;
  detail: string;
  path?: string;
  branch?: string;
  /** The base the branch started from, as a person would name it. */
  baseRef?: string;
}

export interface WorktreeOptions {
  /** Unset means the remote default branch when it resolves, else HEAD. */
  baseRef?: GitRefName;
  /** Remote-tracking branch to set as the new branch's upstream. */
  upstream?: string;
}

/** A remote-tracking ref fetched within this window is not fetched again. */
export const BASE_FETCH_FRESH_MS = 5 * 60_000;
/** Creating a thread waits at most this long on the network before using the local copy. */
export const BASE_FETCH_TIMEOUT_MS = 15_000;

/** Refspec form, so nothing from the renderer is ever read as an option or a revision. */
export function fetchBranchArgs(remote: string, branch: GitRefName | string): string[] {
  return ["fetch", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`];
}

const fetchedAt = new Map<string, number>();

async function remotes(repository: string): Promise<string[]> {
  const listed = await git(repository, ["remote"]);
  return listed.ok ? listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : [];
}

async function refExists(repository: string, fullName: string): Promise<boolean> {
  return (await git(repository, ["show-ref", "--verify", "--quiet", fullName])).ok;
}

/** `origin/HEAD` when it is set, else `origin/main` or `origin/master` if present, else `HEAD`. */
export async function defaultWorktreeBase(repository: string, known?: string[]): Promise<string> {
  const names = known ?? (await remotes(repository));
  if (!names.includes("origin")) return "HEAD";
  const symbolic = await git(repository, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const target = symbolic.stdout.trim();
  if (symbolic.ok && target && target !== "origin/HEAD") return target;
  for (const candidate of ["main", "master"]) {
    if (await refExists(repository, `refs/remotes/origin/${candidate}`)) return `origin/${candidate}`;
  }
  return "HEAD";
}

/** Split `origin/feature/x` into its remote and branch, longest remote name first. */
export function splitRemoteRef(ref: string, names: string[]): { remote: string; branch: string } | undefined {
  const remote = [...names].sort((a, b) => b.length - a.length).find((name) => ref.startsWith(`${name}/`));
  if (!remote) return undefined;
  const branch = ref.slice(remote.length + 1);
  return branch && branch !== "HEAD" ? { remote, branch } : undefined;
}

type ResolvedBase = { ok: true; ref: string; commit: string; note?: string } | { ok: false; detail: string };

/**
 * Turn a chosen base into a commit, fetching a remote-tracking branch first
 * when this app has not fetched it recently. An unreachable remote is not
 * fatal while a local copy exists: the thread starts from that and says so.
 */
export async function resolveWorktreeBase(repository: string, requested?: GitRefName): Promise<ResolvedBase> {
  const names = await remotes(repository);
  const ref = requested ?? (await defaultWorktreeBase(repository, names));
  const remoteRef = splitRemoteRef(ref, names);
  let note: string | undefined;
  if (remoteRef) {
    const key = `${path.resolve(repository)}\0${ref}`;
    if (Date.now() - (fetchedAt.get(key) ?? 0) > BASE_FETCH_FRESH_MS) {
      const fetched = await git(repository, fetchBranchArgs(remoteRef.remote, remoteRef.branch), process.env, BASE_FETCH_TIMEOUT_MS);
      if (fetched.ok) fetchedAt.set(key, Date.now());
      else if (await refExists(repository, `refs/remotes/${ref}`)) {
        note = `Could not fetch ${ref}, so the worktree starts from the copy fetched earlier. ${remoteCommandFailure(fetched.stderr, "")}`.trim();
      } else {
        return { ok: false, detail: remoteCommandFailure(fetched.stderr, `Could not fetch ${ref}. Check that the branch exists on ${remoteRef.remote}.`) };
      }
    }
  }
  const qualified = remoteRef ? `refs/remotes/${ref}` : (await refExists(repository, `refs/heads/${ref}`)) ? `refs/heads/${ref}` : ref;
  const commit = await git(repository, ["rev-parse", "--verify", "--quiet", `${qualified}^{commit}`]);
  if (!commit.ok || !commit.stdout.trim()) return { ok: false, detail: `${ref} is not a branch or commit in this repository.` };
  return { ok: true, ref, commit: commit.stdout.trim(), ...(note ? { note } : {}) };
}

export async function createWorktree(
  repository: string,
  destination: string,
  branch: string,
  options: WorktreeOptions = {},
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
    const base = await resolveWorktreeBase(repository, options.baseRef);
    if (!base.ok) return { ok: false, detail: base.detail };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // A commit, not the ref: Git would otherwise make the remote default
    // branch this branch's upstream, and a push would aim at main.
    const added = await git(root.stdout.trim(), ["worktree", "add", "--no-track", "-b", branch, destination, base.commit]);
    if (!added.ok) return { ok: false, detail: added.stderr || added.stdout || "Could not create worktree." };
    if (options.upstream) await git(destination, ["branch", `--set-upstream-to=${options.upstream}`, branch]);
    return { ok: true, detail: base.note ?? `Created ${branch} from ${base.ref}.`, path: destination, branch, baseRef: base.ref };

  });
}

/**
 * Move a not-yet-used worktree's branch to a different base. Refused when the
 * branch holds anything of its own: uncommitted files, or commits no other
 * branch or remote has.
 */
export async function rebaseFreshWorktree(repository: string, worktree: string, branch: string, baseRef: GitRefName): Promise<WorktreeResult> {
  return inRepository(repository, async () => {

    const status = await git(worktree, ["status", "--porcelain"]);
    if (!status.ok) return { ok: false, detail: status.stderr || `Could not inspect ${worktree}.` };
    if (status.stdout.trim()) return { ok: false, detail: "The worktree has changes, so its base branch can no longer change." };
    const own = await git(worktree, ["rev-list", "--count", "HEAD", "--not", `--exclude=${branch}`, "--branches", "--remotes"]);
    if (!own.ok || own.stdout.trim() !== "0") {
      return { ok: false, detail: "The worktree branch has its own commits, so its base branch can no longer change." };
    }
    const base = await resolveWorktreeBase(repository, baseRef);
    if (!base.ok) return { ok: false, detail: base.detail };
    const moved = await git(worktree, ["reset", "--keep", base.commit]);
    if (!moved.ok) return { ok: false, detail: moved.stderr || "Could not move the worktree to the new base." };
    return { ok: true, detail: base.note ?? `${branch} now starts from ${base.ref}.`, path: worktree, branch, baseRef: base.ref };

  });
}

/** Default first, then branches by most recent commit. Reads local refs only; never fetches. */
export async function listWorktreeBases(repository: string): Promise<WorktreeBases> {
  return inRepository(repository, async () => {

    const names = await remotes(repository);
    const defaultRef = await defaultWorktreeBase(repository, names);
    const current = (await git(repository, ["branch", "--show-current"])).stdout.trim();
    const listed = await git(repository, [
      "for-each-ref", "--sort=-committerdate", "--count=80",
      "--format=%(refname)%00%(committerdate:iso-strict)%00%(symref)", "refs/heads", "refs/remotes",
    ]);
    const choices: WorktreeBaseChoice[] = [];
    for (const line of listed.ok ? listed.stdout.split("\n") : []) {
      const [full, committedAt, symref] = line.split("\0");
      if (!full || symref) continue;
      const remote = full.startsWith("refs/remotes/");
      const ref = full.replace(/^refs\/(heads|remotes)\//, "");
      if (remote && ref.endsWith("/HEAD")) continue;
      choices.push({ ref, kind: remote ? "remote" : "local", ...(committedAt ? { committedAt } : {}) });
    }
    return {
      defaultRef,
      ...(names.includes("origin") ? { remote: "origin" } : {}),
      ...(current ? { currentBranch: current } : {}),
      choices,
    };

  }, JSON.stringify(["listWorktreeBases"]));
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

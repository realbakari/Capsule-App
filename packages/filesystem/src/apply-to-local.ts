import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ApplyRecord, ApplyResult } from "@capsule/shared";
import { readWorktreeRevision } from "./checkpoints.js";
import { git, inRepository } from "./git-process.js";

/**
 * Land a worktree conversation's work on the project's own checkout.
 *
 * The change set is the worktree's whole state (commits on its branch, edits,
 * untracked files) measured from the merge-base with the checkout's HEAD, as
 * one binary patch. It lands as unstaged changes: the user reviews and commits
 * in the checkout. Git's 3-way apply needs an index, so it gets a private one
 * seeded from the checkout's working files; the user's real index is never
 * written, and a conflict leaves ordinary markers in the file.
 *
 * Before anything is written, the checkout's files (tracked and untracked) are
 * snapshotted to a hidden ref. The ref's commit message carries what the apply
 * touched, so the ref alone is the record: undo restores those paths from it,
 * and "applied 5m ago" is read back from it.
 */

const REF_ROOT = "refs/capsule/apply-undo";
const META_MARKER = "capsule-apply-to-local";
const CAPSULE_IDENTITY = { GIT_AUTHOR_NAME: "Capsule", GIT_AUTHOR_EMAIL: "capsule@localhost", GIT_COMMITTER_NAME: "Capsule", GIT_COMMITTER_EMAIL: "capsule@localhost" };

/** Operations that leave the checkout mid-way; applying on top would tangle two pieces of work. */
const IN_PROGRESS: Array<[string, string]> = [
  ["MERGE_HEAD", "a merge"],
  ["rebase-merge", "a rebase"],
  ["rebase-apply", "a rebase"],
  ["CHERRY_PICK_HEAD", "a cherry-pick"],
  ["REVERT_HEAD", "a revert"],
];

function safeSession(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "session";
}

export function applyUndoPrefix(sessionId: string): string {
  return `${REF_ROOT}/${safeSession(sessionId)}`;
}

export function applyUndoRef(sessionId: string, at: number): string {
  return `${applyUndoPrefix(sessionId)}/${Math.max(0, Math.floor(at))}`;
}

interface ChangeSet {
  base: string;
  tree: string;
  /** Paths as they end up in the checkout, for the user. */
  files: string[];
  /** Every path the patch writes or removes, rename sources included, for undo. */
  paths: string[];
}

async function absoluteGitDir(cwd: string, which: "--git-dir" | "--git-common-dir"): Promise<string> {
  const result = await git(cwd, ["rev-parse", which]);
  if (!result.ok || !result.stdout.trim()) throw new Error("Could not resolve the Git directory.");
  const dir = result.stdout.trim();
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

async function revParse(cwd: string, rev: string): Promise<string | undefined> {
  const result = await git(cwd, ["rev-parse", "--verify", "--quiet", rev]);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

/** `--name-status -z`: a status, then one path, or two for a rename or copy. */
function parseNameStatus(text: string): { files: string[]; paths: string[] } {
  const fields = text.split("\0");
  const files: string[] = [];
  const paths = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[++i];
      const to = fields[++i];
      if (from && status.startsWith("R")) paths.add(from);
      if (to) { files.push(to); paths.add(to); }
    } else {
      const file = fields[++i];
      if (file) { files.push(file); paths.add(file); }
    }
  }
  return { files, paths: [...paths] };
}

async function readChangeSet(worktree: string, checkout: string): Promise<ChangeSet> {
  const checkoutHead = await revParse(checkout, "HEAD");
  const worktreeHead = await revParse(worktree, "HEAD");
  if (!checkoutHead || !worktreeHead) throw new Error("Both the project folder and the worktree need at least one commit.");
  const base = await git(checkout, ["merge-base", checkoutHead, worktreeHead]);
  if (!base.ok || !base.stdout.trim()) throw new Error("The worktree's branch shares no history with the project folder.");
  const { tree } = await readWorktreeRevision(worktree);
  const listed = await git(checkout, ["diff", "--name-status", "-z", "-M", "--no-ext-diff", base.stdout.trim(), tree]);
  if (!listed.ok) throw new Error(listed.stderr || "Could not list the worktree's changes.");
  return { base: base.stdout.trim(), tree, ...parseNameStatus(listed.stdout) };
}

/** How many files an apply would land, without writing anything. */
export async function readWorktreeChangeCount(worktree: string, checkout: string): Promise<number> {
  return inRepository(checkout, async () => (await readChangeSet(worktree, checkout)).files.length);
}

/** Why the checkout cannot take an apply right now, or undefined when it can. */
export async function checkoutBlocker(checkout: string): Promise<string | undefined> {
  const gitDir = await absoluteGitDir(checkout, "--git-dir");
  for (const [marker, label] of IN_PROGRESS) {
    const present = await fs.access(path.join(gitDir, marker)).then(() => true, () => false);
    if (present) return `The project folder has ${label} in progress. Finish or abort it, then apply.`;
  }
  const unmerged = await git(checkout, ["ls-files", "-u"]);
  if (unmerged.ok && unmerged.stdout.trim()) return "The project folder has unresolved conflicts. Resolve them, then apply.";
  return undefined;
}

function recordMessage(record: Omit<ApplyRecord, "undoRef">): string {
  return `${META_MARKER}\n\n${JSON.stringify(record)}\n`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseRecord(undoRef: string, message: string): ApplyRecord | undefined {
  if (!message.startsWith(META_MARKER)) return undefined;
  try {
    const value = JSON.parse(message.slice(META_MARKER.length).trim()) as Record<string, unknown>;
    if (typeof value.at !== "string" || !Array.isArray(value.paths)) return undefined;
    return {
      undoRef,
      at: value.at,
      files: strings(value.files),
      paths: strings(value.paths),
      conflicts: strings(value.conflicts),
      ...(typeof value.branch === "string" ? { branch: value.branch } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Put `paths` back to how `tree` had them, deleting the ones it did not have.
 * A private index seeded from the current files lets `git restore` see paths
 * the apply created, so they are removed rather than left behind.
 */
async function restorePaths(checkout: string, tree: string, paths: string[]): Promise<{ ok: boolean; detail: string }> {
  if (paths.length === 0) return { ok: true, detail: "" };
  const commonDir = await absoluteGitDir(checkout, "--git-common-dir");
  const tempIndex = path.join(commonDir, `capsule-apply-restore-index-${randomUUID()}`);
  const pathspec = path.join(commonDir, `capsule-apply-paths-${randomUUID()}`);
  try {
    const current = await readWorktreeRevision(checkout);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    const seeded = await git(checkout, ["read-tree", current.tree], env);
    if (!seeded.ok) return { ok: false, detail: seeded.stderr };
    // restore rejects a path neither side has, e.g. a created file the user since deleted.
    const known = new Set<string>();
    for (const side of [tree, current.tree]) {
      const listed = await git(checkout, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", side, "--", ...paths]);
      for (const entry of listed.stdout.split("\0")) if (entry) known.add(entry);
    }
    const restorable = paths.filter((entry) => known.has(entry));
    if (restorable.length === 0) return { ok: true, detail: "" };
    await fs.writeFile(pathspec, restorable.join("\0"));
    const restored = await git(checkout, ["--literal-pathspecs", "restore", "--source", tree, "--worktree", `--pathspec-from-file=${pathspec}`, "--pathspec-file-nul"], env);
    return { ok: restored.ok, detail: restored.stderr };
  } finally {
    await fs.rm(tempIndex, { force: true }).catch(() => undefined);
    await fs.rm(pathspec, { force: true }).catch(() => undefined);
  }
}

export async function applyWorktreeChanges(input: {
  worktree: string;
  checkout: string;
  undoRef: string;
  branch?: string;
  at?: Date;
}): Promise<ApplyResult> {
  const { worktree, checkout, undoRef } = input;
  return inRepository(checkout, async () => {
    const blocker = await checkoutBlocker(checkout);
    if (blocker) return { applied: false, files: [], conflicts: [], detail: blocker };
    const changes = await readChangeSet(worktree, checkout);
    if (changes.files.length === 0) return { applied: false, files: [], conflicts: [], detail: "The worktree has no changes to apply." };

    const commonDir = await absoluteGitDir(checkout, "--git-common-dir");
    const tempIndex = path.join(commonDir, `capsule-apply-index-${randomUUID()}`);
    const patchFile = path.join(commonDir, `capsule-apply-${randomUUID()}.patch`);
    try {
      const before = await readWorktreeRevision(checkout);
      const patch = await git(checkout, ["diff", "--binary", "--full-index", "-M", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", changes.base, changes.tree]);
      if (!patch.ok) return { applied: false, files: [], conflicts: [], detail: patch.stderr || "Could not build the patch." };
      await fs.writeFile(patchFile, patch.stdout);

      const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
      const seeded = await git(checkout, ["read-tree", before.tree], env);
      if (!seeded.ok) return { applied: false, files: [], conflicts: [], detail: seeded.stderr };
      // read-tree leaves no stat data, and apply would take every file as modified.
      await git(checkout, ["update-index", "-q", "--refresh"], env);
      const applied = await git(checkout, ["apply", "--3way", "--whitespace=nowarn", patchFile], env);
      const unmerged = await git(checkout, ["ls-files", "--unmerged", "-z"], env);
      const conflicts = unmerged.ok ? [...new Set(unmerged.stdout.split("\0").map((entry) => entry.split("\t").slice(1).join("\t")).filter(Boolean))] : [];

      if (!applied.ok && conflicts.length === 0) {
        // A refused patch should write nothing; put back anything it did.
        await restorePaths(checkout, before.tree, changes.paths);
        const errors = applied.stderr.split("\n").filter((line) => line.startsWith("error:")).join("\n");
        return { applied: false, files: [], conflicts: [], detail: errors || applied.stderr || "Git could not apply the changes." };
      }

      const at = (input.at ?? new Date()).toISOString();
      const message = recordMessage({ at, files: changes.files, paths: changes.paths, conflicts, ...(input.branch ? { branch: input.branch } : {}) });
      const commit = await git(checkout, ["commit-tree", before.tree, "-m", message], { ...process.env, ...CAPSULE_IDENTITY });
      const saved = commit.ok ? await git(checkout, ["update-ref", undoRef, commit.stdout.trim()]) : commit;
      return {
        applied: true,
        files: changes.files,
        conflicts,
        ...(saved.ok ? { undoRef } : { detail: `Applied, but the undo point could not be saved: ${saved.stderr}` }),
      };
    } finally {
      await fs.rm(tempIndex, { force: true }).catch(() => undefined);
      await fs.rm(patchFile, { force: true }).catch(() => undefined);
    }
  });
}

/** One apply's record, or undefined when the ref is gone or is not an undo point. */
export async function readApplyRecord(checkout: string, undoRef: string): Promise<ApplyRecord | undefined> {
  if (!undoRef.startsWith(`${REF_ROOT}/`) || undoRef.includes("..")) return undefined;
  const message = await git(checkout, ["log", "-1", "--format=%B", `${undoRef}^{commit}`, "--"]);
  return message.ok ? parseRecord(undoRef, message.stdout) : undefined;
}

/** The newest apply for a session whose undo point still exists. */
export async function latestApplyRecord(checkout: string, sessionId: string): Promise<ApplyRecord | undefined> {
  const listed = await git(checkout, ["for-each-ref", "--format=%(refname)", `${applyUndoPrefix(sessionId)}/`]);
  if (!listed.ok) return undefined;
  const newest = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    .sort((a, b) => Number(b.split("/").pop()) - Number(a.split("/").pop()))[0];
  return newest ? readApplyRecord(checkout, newest) : undefined;
}

/**
 * Put the paths an apply wrote back to the snapshot, then drop the ref.
 * Other edits in the checkout made since are left alone.
 */
export async function undoWorktreeApply(checkout: string, undoRef: string): Promise<{ ok: boolean; detail: string; files: string[] }> {
  return inRepository(checkout, async () => {
    const record = await readApplyRecord(checkout, undoRef);
    const tree = record ? await revParse(checkout, `${undoRef}^{tree}`) : undefined;
    if (!record || !tree) return { ok: false, detail: "That apply can no longer be undone.", files: [] };
    const restored = await restorePaths(checkout, tree, record.paths);
    if (!restored.ok) return { ok: false, detail: restored.detail || "Could not restore the project folder.", files: [] };
    await git(checkout, ["update-ref", "-d", undoRef]);
    return { ok: true, detail: `Restored ${record.files.length} file${record.files.length === 1 ? "" : "s"}.`, files: record.files };
  });
}

/** Drop every undo point for a session, e.g. when its thread is deleted. */
export async function deleteApplyRecords(checkout: string, sessionId: string): Promise<number> {
  return inRepository(checkout, async () => {
    const listed = await git(checkout, ["for-each-ref", "--format=%(refname)", `${applyUndoPrefix(sessionId)}/`]);
    if (!listed.ok) return 0;
    let removed = 0;
    for (const ref of listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
      if ((await git(checkout, ["update-ref", "-d", ref])).ok) removed += 1;
    }
    return removed;
  });
}

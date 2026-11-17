import { applyBranchPrefix, type GitChange, type GitStatus } from "@capsule/shared";

/** Where the current branch stands against its remote: one state, so Push and Pull never disagree. */
export type SyncState =
  | { kind: "detached" }
  | { kind: "no-remote" }
  | { kind: "publish"; remote: string; }
  | { kind: "synced"; upstream: string; }
  | { kind: "ahead"; upstream: string; ahead: number; }
  | { kind: "behind"; upstream: string; behind: number; }
  | { kind: "diverged"; upstream: string; ahead: number; behind: number; };

export function syncState(git: GitStatus): SyncState {
  if (!git.branch || git.branch === "HEAD") return { kind: "detached" };
  if (!git.upstream) return git.pushRemote ? { kind: "publish", remote: git.pushRemote } : { kind: "no-remote" };
  const ahead = git.ahead ?? 0;
  const behind = git.behind ?? 0;
  if (ahead && behind) return { kind: "diverged", upstream: git.upstream, ahead, behind };
  if (behind) return { kind: "behind", upstream: git.upstream, behind };
  if (ahead) return { kind: "ahead", upstream: git.upstream, ahead };
  return { kind: "synced", upstream: git.upstream };
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Why Push cannot run in this state; undefined when it can. */
export function pushBlocked(state: SyncState): string | undefined {
  switch (state.kind) {
    case "detached": return "Check out a branch before pushing.";
    case "no-remote": return "This repository has no remote to push to, or several and none is chosen.";
    case "synced": return `Nothing to push: ${state.upstream} has every commit.`;
    case "behind": return `Pull first: ${state.upstream} has ${plural(state.behind, "commit")} this branch lacks.`;
    case "diverged": return `Pull first: ${state.upstream} has ${plural(state.behind, "commit")} this branch lacks.`;
    default: return undefined;
  }
}

/** What Commit takes: the staged index when there is one, else the files the user ticks. */
export type CommitPlan =
  | { kind: "clean" }
  | { kind: "staged"; count: number; }
  | { kind: "choose"; tracked: GitChange[]; untracked: GitChange[]; };

const stagedCode = (code: string) => code[0] !== undefined && code[0] !== " " && code[0] !== "?";

export function commitPlan(files: readonly GitChange[]): CommitPlan {
  if (files.length === 0) return { kind: "clean" };
  const staged = files.filter((file) => stagedCode(file.code)).length;
  if (staged) return { kind: "staged", count: staged };
  return {
    kind: "choose",
    tracked: files.filter((file) => !file.code.startsWith("?")),
    untracked: files.filter((file) => file.code.startsWith("?")),
  };
}

export function onDefaultBranch(git: GitStatus): boolean {
  return Boolean(git.branch && git.branch === git.defaultBranch);
}

/** A branch name from the work's own words, under the configured prefix, not colliding with one that exists. */
export function suggestBranch(prefix: string | undefined, words: string | undefined, taken: readonly string[]): string {
  const slug = (words ?? "").split(/\r?\n/)[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "changes";
  const base = applyBranchPrefix(prefix, slug);
  let name = base;
  for (let count = 2; taken.includes(name); count++) name = `${base}-${count}`;
  return name;
}

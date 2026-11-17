import fs from "node:fs";
import path from "node:path";
import type { GitPullMode } from "@capsule/shared";
import { git, inRepository } from "./git-process.js";
import { remoteCommandFailure } from "./remote-errors.js";

/** How the current branch relates to its remote, read from local refs and config only. */
export interface GitTracking {
  branches: string[];
  /** Remote-tracking branches with no local branch of the same name, as `remote/branch`. */
  remoteBranches: string[];
  /** Local branches checked out in another worktree, with that worktree's folder. */
  checkedOutElsewhere: Record<string, string>;
  /** The same-named remote branch HEAD tracks. Absent: the branch was never published. */
  upstream?: string;
  pushRemote?: string;
  defaultBranch?: string;
  ahead?: number;
  behind?: number;
}

const FIELD = "%00";
const REF_FORMAT = ["%(refname)", "%(upstream)", "%(upstream:remotename)", "%(push:remotename)", "%(worktreepath)", "%(symref)"].join(FIELD);

interface RefRow { refname: string; upstream: string; upstreamRemote: string; pushRemote: string; worktree: string; symref: string; }

/** Pure: for-each-ref rows and the remote list, as tracking for `branch` checked out at `toplevel`. */
export function parseTracking(output: string, remotes: readonly string[], branch: string | undefined, toplevel: string | undefined): Omit<GitTracking, "ahead" | "behind"> {
  const rows: RefRow[] = output.split("\n").filter(Boolean).map((line) => {
    const [refname = "", upstream = "", upstreamRemote = "", pushRemote = "", worktree = "", symref = ""] = line.split("\0");
    return { refname, upstream, upstreamRemote, pushRemote, worktree, symref };
  });
  const heads = rows.filter((row) => row.refname.startsWith("refs/heads/"));
  const branches = heads.map((row) => row.refname.slice("refs/heads/".length));
  const local = new Set(branches);
  const current = heads.find((row) => row.refname === `refs/heads/${branch}`);
  // A branch started from origin/main tracks it as a base, not as where it publishes.
  const upstream = current && current.upstreamRemote && current.upstream === `refs/remotes/${current.upstreamRemote}/${branch}`
    ? `${current.upstreamRemote}/${branch}` : undefined;
  // push:remotename already follows branch.<name>.pushRemote, remote.pushDefault and branch.<name>.remote.
  const configured = current?.pushRemote && current.pushRemote !== "." ? current.pushRemote : undefined;
  const pushRemote = configured ?? (remotes.length === 1 ? remotes[0] : remotes.includes("origin") ? "origin" : undefined);
  const remoteHead = (remote: string | undefined) => {
    const target = remote ? rows.find((row) => row.refname === `refs/remotes/${remote}/HEAD`)?.symref : undefined;
    return target?.startsWith(`refs/remotes/${remote}/`) ? target.slice(`refs/remotes/${remote}/`.length) : undefined;
  };
  const defaultBranch = remoteHead(pushRemote) ?? remoteHead(current?.upstreamRemote)
    ?? (local.has("main") ? "main" : local.has("master") ? "master" : undefined);
  const remoteBranches = rows
    .filter((row) => row.refname.startsWith("refs/remotes/") && !row.symref && !row.refname.endsWith("/HEAD"))
    .map((row) => row.refname.slice("refs/remotes/".length))
    .filter((name) => {
      const remote = remotes.find((candidate) => name.startsWith(`${candidate}/`));
      return remote !== undefined && !local.has(name.slice(remote.length + 1));
    });
  const checkedOutElsewhere: Record<string, string> = {};
  for (const row of heads) {
    if (row.worktree && toplevel && path.resolve(row.worktree) !== path.resolve(toplevel)) {
      checkedOutElsewhere[row.refname.slice("refs/heads/".length)] = row.worktree;
    }
  }
  return {
    branches,
    remoteBranches,
    checkedOutElsewhere,
    ...(upstream ? { upstream } : {}),
    ...(pushRemote ? { pushRemote } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
  };
}

/** Local refs and config only: never reaches the network. */
export async function readTracking(cwd: string, branch: string | undefined, toplevel: string | undefined): Promise<GitTracking> {
  const [refs, remotes] = await Promise.all([
    git(cwd, ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes"]),
    git(cwd, ["remote"]),
  ]);
  const tracking = parseTracking(refs.ok ? refs.stdout : "", remotes.ok ? remotes.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean) : [], branch, toplevel);
  if (!tracking.upstream) return tracking;
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/${tracking.upstream}`]);
  const [ahead, behind] = counts.ok ? counts.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10)) : [];
  return {
    ...tracking,
    ...(Number.isFinite(ahead) ? { ahead } : {}),
    ...(Number.isFinite(behind) ? { behind } : {}),
  };
}

async function currentTracking(cwd: string): Promise<{ branch?: string; tracking: GitTracking; }> {
  const [branch, toplevel] = await Promise.all([
    git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(cwd, ["rev-parse", "--show-toplevel"]),
  ]);
  const name = branch.ok ? branch.stdout.trim() : undefined;
  return { branch: name, tracking: await readTracking(cwd, name, toplevel.ok ? toplevel.stdout.trim() : undefined) };
}

/** Pushes, pulls and fetches wait on the network and on hooks; thirty seconds stopped real ones. */
export const REMOTE_TIMEOUT = 10 * 60_000;
export const FETCH_TIMEOUT = 60_000;

export interface PushResult { ok: boolean; detail: string; }

export async function pushCurrentBranch(
  cwd: string,
  options: { forceWithLease: boolean; timeout?: number; },
): Promise<PushResult> {
  return inRepository(cwd, async () => {
    const { branch, tracking } = await currentTracking(cwd);
    if (!branch) return { ok: false, detail: "Check out a branch before pushing." };
    if (!tracking.pushRemote) {
      return { ok: false, detail: "This repository has no remote to push to, or several and none is chosen. Add one, or set remote.pushDefault." };
    }
    const publish = !tracking.upstream;
    const args = ["push", ...(options.forceWithLease ? ["--force-with-lease"] : []), ...(publish ? ["-u"] : []), tracking.pushRemote, "HEAD"];
    const result = await git(cwd, args, process.env, options.timeout ?? REMOTE_TIMEOUT);
    if (result.ok) return { ok: true, detail: publish ? `Published ${branch} to ${tracking.pushRemote}.` : "Pushed." };
    const output = `${result.stderr}\n${result.stdout}`;
    const hooks = await readClientHooks(cwd);
    return { ok: false, detail: hookFailure(output, hooks.includes("pre-push") ? "pre-push" : undefined, "push") ?? remoteCommandFailure(output, "Push failed. Check the remote branch and your Git setup.") };
  });
}

export async function pullCurrentBranch(
  cwd: string,
  mode: GitPullMode,
  options: { timeout?: number; } = {},
): Promise<{ ok: boolean; detail: string; diverged?: boolean; }> {
  return inRepository(cwd, async () => {
    const { branch, tracking } = await currentTracking(cwd);
    if (!branch) return { ok: false, detail: "Check out a branch before pulling." };
    if (!tracking.upstream) return { ok: false, detail: `${branch} has not been published, so there is nothing to pull.` };
    const [remote] = tracking.upstream.split("/");
    const args = mode === "rebase"
      ? ["pull", "--rebase", "--no-autostash", remote!, branch]
      : ["pull", "--ff-only", "--no-rebase", remote!, branch];
    const result = await git(cwd, args, process.env, options.timeout ?? REMOTE_TIMEOUT);
    if (result.ok) return { ok: true, detail: mode === "rebase" ? `Rebased onto ${tracking.upstream}.` : `Pulled from ${tracking.upstream}.` };
    const output = `${result.stderr}\n${result.stdout}`;
    if (mode === "rebase" && await rebaseInProgress(cwd)) {
      // A half-finished rebase would leave the folder in a state no button here can finish.
      await git(cwd, ["rebase", "--abort"]);
      return { ok: false, detail: `Rebasing onto ${tracking.upstream} stopped on a conflict, so nothing changed. Resolve it in the terminal with git pull --rebase.` };
    }
    if (/not possible to fast-forward|diverging branches|have diverged/i.test(output)) {
      return { ok: false, diverged: true, detail: `${branch} and ${tracking.upstream} have both changed. Rebase your commits onto it, or merge in the terminal.` };
    }
    const local = output.match(/(error: Your local changes[\s\S]*?)(?:\nAborting|$)|(error: cannot pull with rebase[^\n]*)/i);
    if (local) return { ok: false, detail: (local[1] ?? local[2] ?? "").replace(/^error: /, "").trim() };
    return { ok: false, detail: remoteCommandFailure(output, "Pull failed. Check the remote branch and your Git setup.") };
  });
}

async function rebaseInProgress(cwd: string): Promise<boolean> {
  const located = await git(cwd, ["rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply"]);
  if (!located.ok) return false;
  return located.stdout.split(/\r?\n/).filter(Boolean).some((entry) => fs.existsSync(path.resolve(cwd, entry.trim())));
}

const FETCH_FRESH_MS = 2 * 60_000;
const FETCH_BACKOFF_MS = 10 * 60_000;
const fetches = new Map<string, { at: number; ok: boolean; pending?: Promise<boolean>; }>();

/** Forgets fetch history, for tests and a Doctor run. */
export function clearFetchState(): void {
  fetches.clear();
}

/*
 * A background fetch must never ask anyone anything. With no terminal, Git
 * would otherwise try an askpass helper, a credential manager's window, or
 * ssh's passphrase prompt on the controlling terminal of `pnpm dev`.
 */
async function quietRemoteEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", SSH_ASKPASS_REQUIRE: "never" };
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  const ownSsh = env.GIT_SSH_COMMAND || env.GIT_SSH || (await git(cwd, ["config", "--get", "core.sshCommand"])).stdout.trim();
  if (!ownSsh) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return env;
}

/**
 * Refreshes remote-tracking refs so ahead and behind are true, at most every
 * two minutes per remote and every ten after a failure. Quiet: a failure is
 * an answer of `false`, never an error. Runs outside the repository queue
 * because it writes only remote-tracking refs, and `--no-write-fetch-head`
 * keeps it from racing a pull for FETCH_HEAD.
 */
export async function fetchRemote(cwd: string, options: { force?: boolean; timeout?: number; now?: number; } = {}): Promise<boolean> {
  const { tracking } = await currentTracking(cwd);
  const remote = tracking.upstream?.split("/")[0] ?? tracking.pushRemote;
  if (!remote) return false;
  const common = await git(cwd, ["rev-parse", "--git-common-dir"]);
  const key = `${common.ok ? path.resolve(cwd, common.stdout.trim()) : path.resolve(cwd)}\0${remote}`;
  const now = options.now ?? Date.now();
  const last = fetches.get(key);
  if (last?.pending) return last.pending;
  if (!options.force && last && now - last.at < (last.ok ? FETCH_FRESH_MS : FETCH_BACKOFF_MS)) return false;
  const pending = (async () => {
    const result = await git(cwd, ["fetch", "--quiet", "--no-tags", "--no-auto-gc", "--no-write-fetch-head", "--", remote], await quietRemoteEnv(cwd), options.timeout ?? FETCH_TIMEOUT);
    fetches.set(key, { at: now, ok: result.ok });
    return result.ok;
  })();
  fetches.set(key, { at: last?.at ?? 0, ok: last?.ok ?? true, pending });
  return pending;
}

/** The client hooks a commit or push would run, by name. */
export async function readClientHooks(cwd: string): Promise<string[]> {
  const located = await git(cwd, ["rev-parse", "--git-path", "hooks"]);
  if (!located.ok) return [];
  const folder = path.resolve(cwd, located.stdout.trim());
  const names = ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-push"];
  const present = await Promise.all(names.map((name) => fs.promises.access(path.join(folder, name), fs.constants.X_OK).then(() => true, () => false)));
  return names.filter((_, index) => present[index]);
}

const TERMINAL_STYLE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const GIT_OWN_FAILURE = /nothing (added )?to commit|no changes added to commit|please tell me who you are|unable to auto-detect email|index\.lock|partial commit during a merge|pathspec .* did not match|\[rejected\]|non-fast-forward|fetch first|authentication failed|could not read (username|password)|could not resolve host|repository not found|permission denied/i;

/**
 * A hook's own words when a hook stopped the work, or undefined when Git's
 * failure is about something else. URLs are redacted: push output can carry
 * credentials in a remote's address.
 */
export function hookFailure(output: string, hook: string | undefined, work: "commit" | "push"): string | undefined {
  if (!hook || GIT_OWN_FAILURE.test(output)) return undefined;
  const lines = output
    .replace(TERMINAL_STYLE, "")
    .replace(/\S+:\/\/\S+/g, "<remote>")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^error: failed to push some refs/.test(line));
  const tail = lines.slice(-30).join("\n");
  const who = work === "commit" ? "A commit hook" : `The ${hook} hook`;
  return tail ? `${who} stopped the ${work}. Its output:\n${tail}` : `${who} stopped the ${work} without printing why.`;
}

/** Subjects and bodies of the commits on HEAD that `base` lacks, oldest first. */
export async function commitsSince(cwd: string, base: string): Promise<Array<{ subject: string; body: string; }>> {
  const result = await git(cwd, ["log", "--reverse", "--format=%s%x00%b%x1e", `${base}..HEAD`, "--"]);
  if (!result.ok) return [];
  return result.stdout.split("\x1e").map((record) => record.replace(/^\n/, "")).filter(Boolean).map((record) => {
    const [subject = "", body = ""] = record.split("\0");
    return { subject: subject.trim(), body: body.trim() };
  });
}

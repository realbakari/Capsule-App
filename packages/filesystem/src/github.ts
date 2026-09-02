import { spawnSync } from "node:child_process";
import type {
  GitPullRequest,
  GitPullRequestActivity,
  GitPullRequestDetail,
  GitStatus,
  PrMergeMethod,
} from "@capsule/shared";

function run(
  command: string,
  args: string[],
  cwd: string,
  timeout = 12_000,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
  };
}

/*
 * Whether `gh` exists, asked once.
 *
 * enrichGitStatus runs on every git refresh and this spawned a process each
 * time to ask a question whose answer is fixed for the life of the app.
 */
let ghPresent: boolean | undefined;

const pullRequestCache = new Map<string, { value?: GitPullRequest; at: number }>();

export function ghAvailable(): boolean {
  if (ghPresent === undefined) {
    const result = spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 1500 });
    ghPresent = result.status === 0;
  }
  return ghPresent;
}

/** Forgets the cached answer, for a Doctor run that re-checks the environment. */
export function clearGhCache(): void {
  ghPresent = undefined;
  pullRequestCache.clear();
}

export function pushArgs(forceWithLease: boolean): string[] {
  return forceWithLease
    ? ["push", "--force-with-lease", "-u", "origin", "HEAD"]
    : ["push", "-u", "origin", "HEAD"];
}

export function createPullRequestArgs(input: {
  title: string;
  body: string;
  draft: boolean;
}): string[] {
  const args = ["pr", "create", "--title", input.title, "--body", input.body];
  if (input.draft) args.push("--draft");
  return args;
}

export function mergePullRequestArgs(method: PrMergeMethod, auto: boolean): string[] {
  const args = ["pr", "merge"];
  if (method === "squash") args.push("--squash");
  else if (method === "rebase") args.push("--rebase");
  else args.push("--merge");
  if (auto) args.push("--auto");
  return args;
}

export function lastCommitSubject(cwd: string): string {
  return run("git", ["log", "-1", "--pretty=%s"], cwd, 4000).stdout.trim();
}

export function pushCurrentBranch(
  cwd: string,
  forceWithLease: boolean,
): { ok: boolean; detail: string } {
  const result = run("git", pushArgs(forceWithLease), cwd, 30_000);
  if (result.ok) return { ok: true, detail: result.stdout.trim() || "Pushed." };
  return { ok: false, detail: result.stderr || result.stdout.trim() || "Push failed." };
}

function checkRollup(
  value: unknown,
): GitPullRequest["checks"] {
  if (!Array.isArray(value) || value.length === 0) return "none";
  const states = value.map((item) =>
    String((item as { state?: string; conclusion?: string }).state ?? (item as { conclusion?: string }).conclusion ?? "")
      .toUpperCase(),
  );
  if (states.some((state) => state === "FAILURE" || state === "FAILED" || state === "ERROR")) {
    return "failure";
  }
  if (states.some((state) => state === "PENDING" || state === "QUEUED" || state === "IN_PROGRESS")) {
    return "pending";
  }
  if (states.every((state) => state === "SUCCESS" || state === "SKIPPED" || state === "NEUTRAL")) {
    return "success";
  }
  return "pending";
}

export function parsePullRequestList(raw: string): GitPullRequest[] {
  try {
    const rows = JSON.parse(raw) as Array<{
      number?: number;
      url?: string;
      title?: string;
      isDraft?: boolean;
      state?: string;
      mergeStateStatus?: string;
      reviewDecision?: string;
      statusCheckRollup?: unknown;
      author?: { login?: string; name?: string };
      headRefName?: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => Boolean(row.number && row.url))
      .map((row) => ({
        number: row.number!,
        url: row.url!,
        title: row.title ?? `Pull request #${row.number}`,
        isDraft: Boolean(row.isDraft),
        state: row.state ?? "OPEN",
        mergeState: row.mergeStateStatus,
        reviewDecision: row.reviewDecision || undefined,
        checks: checkRollup(row.statusCheckRollup),
        author: row.author?.login || row.author?.name || undefined,
        headRefName: row.headRefName || undefined,
        createdAt: row.createdAt || undefined,
        updatedAt: row.updatedAt || undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * The open pull requests, or `undefined` when the host could not be asked.
 *
 * An empty array used to mean both "this repository has none" and "the call
 * failed", so a slow or offline lookup was reported to the reader as fact.
 * `statusCheckRollup` alone takes ten seconds on a busy repository, so this is
 * the common case, not the rare one — hence the wider budget too.
 */
export function listPullRequests(cwd: string): GitPullRequest[] | undefined {
  const result = run(
    "gh",
    [
      "pr",
      "list",
      "--limit",
      "50",
      "--json",
      "number,url,title,isDraft,state,mergeStateStatus,reviewDecision,statusCheckRollup,author,headRefName,createdAt,updatedAt",
    ],
    cwd,
    30_000,
  );
  return result.ok ? parsePullRequestList(result.stdout) : undefined;
}

function actorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as { login?: unknown; name?: unknown };
  if (typeof actor.login === "string" && actor.login) return actor.login;
  return typeof actor.name === "string" && actor.name ? actor.name : undefined;
}

/** Parse the `gh pr view --json` shape without trusting optional host fields. */
export function parsePullRequestDetail(raw: string, diff = ""): GitPullRequestDetail | undefined {
  try {
    const row = JSON.parse(raw) as Record<string, unknown>;
    const number = typeof row.number === "number" ? row.number : 0;
    const url = typeof row.url === "string" ? row.url : "";
    if (!number || !url) return undefined;
    const comments = Array.isArray(row.comments) ? row.comments : [];
    const reviews = Array.isArray(row.reviews) ? row.reviews : [];
    const activity: GitPullRequestActivity[] = [
      ...comments.map((value, index) => {
        const item = value as Record<string, unknown>;
        return {
          id: typeof item.id === "string" ? item.id : `comment-${index}`,
          kind: "comment" as const,
          author: actorName(item.author),
          body: typeof item.body === "string" ? item.body : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
        };
      }),
      ...reviews.map((value, index) => {
        const item = value as Record<string, unknown>;
        return {
          id: typeof item.id === "string" ? item.id : `review-${index}`,
          kind: "review" as const,
          author: actorName(item.author),
          body: typeof item.body === "string" ? item.body : "",
          createdAt: typeof item.submittedAt === "string" ? item.submittedAt : undefined,
          state: typeof item.state === "string" ? item.state : undefined,
        };
      }),
    ].sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
    const labels = (Array.isArray(row.labels) ? row.labels : [])
      .map((value) => {
        if (typeof value === "string") return value;
        return value && typeof value === "object" && !Array.isArray(value)
          ? String((value as { name?: unknown }).name ?? "")
          : "";
      })
      .filter(Boolean);
    const reviewers = (Array.isArray(row.reviewRequests) ? row.reviewRequests : [])
      .map(actorName)
      .filter((value): value is string => Boolean(value));
    const commits = (Array.isArray(row.commits) ? row.commits : []).map((value, index) => {
      const item = value as Record<string, unknown>;
      const authors = (Array.isArray(item.authors) ? item.authors : [])
        .map(actorName)
        .filter((value): value is string => Boolean(value));
      return {
        oid: typeof item.oid === "string" ? item.oid : `commit-${index}`,
        title: typeof item.messageHeadline === "string" ? item.messageHeadline : "Commit",
        body: typeof item.messageBody === "string" && item.messageBody ? item.messageBody : undefined,
        authoredAt: typeof item.authoredDate === "string" ? item.authoredDate : undefined,
        authors,
      };
    });
    const files = (Array.isArray(row.files) ? row.files : []).flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      if (typeof item.path !== "string" || !item.path) return [];
      return [{
        path: item.path,
        additions: typeof item.additions === "number" ? item.additions : 0,
        deletions: typeof item.deletions === "number" ? item.deletions : 0,
      }];
    });
    const statusCheckRollup = row.statusCheckRollup;
    return {
      number,
      url,
      title: typeof row.title === "string" ? row.title : `Pull request #${number}`,
      body: typeof row.body === "string" ? row.body : "",
      isDraft: Boolean(row.isDraft),
      state: typeof row.state === "string" ? row.state : "OPEN",
      mergeState: typeof row.mergeStateStatus === "string" ? row.mergeStateStatus : undefined,
      reviewDecision: typeof row.reviewDecision === "string" && row.reviewDecision
        ? row.reviewDecision
        : undefined,
      checks: checkRollup(statusCheckRollup),
      author: actorName(row.author),
      headRefName: typeof row.headRefName === "string" ? row.headRefName : undefined,
      baseRefName: typeof row.baseRefName === "string" ? row.baseRefName : undefined,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
      additions: typeof row.additions === "number" ? row.additions : 0,
      deletions: typeof row.deletions === "number" ? row.deletions : 0,
      changedFiles: typeof row.changedFiles === "number" ? row.changedFiles : files.length,
      labels,
      reviewers,
      activity,
      commits,
      files,
      diff,
    };
  } catch {
    return undefined;
  }
}

export function readPullRequestDetail(cwd: string, number: number): GitPullRequestDetail | undefined {
  if (!Number.isInteger(number) || number < 1) return undefined;
  const fields = [
    "number", "url", "title", "body", "isDraft", "state", "mergeStateStatus",
    "reviewDecision", "statusCheckRollup", "author", "headRefName", "baseRefName", "createdAt", "updatedAt",
    "additions", "deletions", "changedFiles", "labels", "reviewRequests", "comments", "reviews",
    "commits", "files",
  ].join(",");
  const detail = run("gh", ["pr", "view", String(number), "--json", fields], cwd, 20_000);
  if (!detail.ok || !detail.stdout.trim()) return undefined;
  const patch = run("gh", ["pr", "diff", String(number), "--color=never"], cwd, 20_000);
  return parsePullRequestDetail(detail.stdout, patch.ok ? patch.stdout : "");
}

export function viewPullRequest(cwd: string): GitPullRequest | undefined {
  const result = run(
    "gh",
    [
      "pr",
      "view",
      "--json",
      "number,url,title,isDraft,state,mergeStateStatus,reviewDecision,statusCheckRollup",
    ],
    cwd,
    12_000,
  );
  if (!result.ok || !result.stdout.trim()) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as {
      number?: number;
      url?: string;
      title?: string;
      isDraft?: boolean;
      state?: string;
      mergeStateStatus?: string;
      reviewDecision?: string;
      statusCheckRollup?: unknown;
    };
    if (!parsed.number || !parsed.url) return undefined;
    const checks = checkRollup(parsed.statusCheckRollup);
    const failed =
      Array.isArray(parsed.statusCheckRollup)
        ? parsed.statusCheckRollup
            .map((item) => {
              const row = item as { name?: string; state?: string; conclusion?: string };
              const state = String(row.state ?? row.conclusion ?? "");
              return /fail|error/i.test(state) ? row.name ?? state : undefined;
            })
            .filter((name): name is string => Boolean(name))
            .join(", ")
        : undefined;
    return {
      number: parsed.number,
      url: parsed.url,
      title: parsed.title ?? `Pull request #${parsed.number}`,
      isDraft: Boolean(parsed.isDraft),
      state: parsed.state ?? "OPEN",
      mergeState: parsed.mergeStateStatus,
      reviewDecision: parsed.reviewDecision || undefined,
      checks,
      checksSummary: failed || undefined,
    };
  } catch {
    return undefined;
  }
}

/*
 * The pull request for a checkout, as last known.
 *
 * `gh pr view` asks GitHub over the network and takes about a second on a busy
 * repository. enrichGitStatus is called on every git refresh, and it ran that
 * synchronously — so every refresh blocked the Electron main process, and with
 * it every other IPC call, on a network round trip. The answer is served from
 * the last reading and refreshed behind it.
 */
const PR_CACHE_TTL_MS = 30_000;

const pullRequestInFlight = new Set<string>();
let onPullRequestSettled: (() => void) | undefined;

/** Called when a background lookup changes the answer, so the UI can catch up. */
export function setPullRequestListener(listener: (() => void) | undefined): void {
  onPullRequestSettled = listener;
}

function cachedPullRequest(cwd: string): GitPullRequest | undefined {
  const cached = pullRequestCache.get(cwd);
  if (cached && Date.now() - cached.at < PR_CACHE_TTL_MS) return cached.value;
  if (!pullRequestInFlight.has(cwd)) {
    pullRequestInFlight.add(cwd);
    // setImmediate, not a worker: the spawn itself is what has to leave the
    // current tick. The call still blocks, but nothing is waiting on it.
    setImmediate(() => {
      let next: GitPullRequest | undefined;
      try {
        next = viewPullRequest(cwd);
      } finally {
        pullRequestInFlight.delete(cwd);
      }
      const previous = pullRequestCache.get(cwd)?.value;
      pullRequestCache.set(cwd, { value: next, at: Date.now() });
      if (previous?.number !== next?.number || previous?.state !== next?.state) {
        onPullRequestSettled?.();
      }
    });
  }
  return cached?.value;
}

export function enrichGitStatus(status: GitStatus, cwd?: string): GitStatus {
  if (!status.isRepo || !cwd) return { ...status, ghAvailable: false };
  const available = ghAvailable();
  const ahead = run("git", ["rev-list", "--count", "@{upstream}..HEAD"], cwd, 3000);
  const behind = run("git", ["rev-list", "--count", "HEAD..@{upstream}"], cwd, 3000);
  return {
    ...status,
    ghAvailable: available,
    ahead: ahead.ok ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : undefined,
    behind: behind.ok ? Number.parseInt(behind.stdout.trim(), 10) || 0 : undefined,
    pullRequest: available ? cachedPullRequest(cwd) : undefined,
  };
}

export function createPullRequest(
  cwd: string,
  input: { title: string; body: string; draft: boolean },
): { ok: boolean; detail: string; url?: string } {
  const result = run("gh", createPullRequestArgs(input), cwd, 30_000);
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const url = text.match(/https:\/\/github\.com\/\S+/)?.[0];
  if (result.ok) return { ok: true, detail: text || "Opened pull request.", url };
  return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not create pull request." };
}

export function mergePullRequest(
  cwd: string,
  method: PrMergeMethod,
  auto: boolean,
): { ok: boolean; detail: string } {
  const result = run("gh", mergePullRequestArgs(method, auto), cwd, 30_000);
  if (result.ok) return { ok: true, detail: result.stdout.trim() || "Merge started." };
  return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not merge pull request." };
}

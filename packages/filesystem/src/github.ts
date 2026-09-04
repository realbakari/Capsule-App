import { inRepository } from "./git-process.js";
import { spawn } from "node:child_process";
import { avatarsFor } from "./avatars.js";
import { INCOMPLETE_GITHUB_RESPONSE, isIncompleteResponse, readGhJson } from "./github-read.js";
import type {
  GitPullRequest,
  GitPullRequestActivity,
  GitPullRequestCheck,
  GitPullRequestLabel,
  GitPullRequestDetail,
  GitStatus,
  PrMergeMethod,
} from "@capsule/shared";

function run(
  command: string,
  args: string[],
  cwd: string,
  timeout = 12_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; }> {
  return runAsync(command, args, cwd, timeout);
}

/*
 * The same, without stopping the world.
 *
 * `gh` reaches GitHub, and on a busy repository it is not quick: listing pull
 * requests on a repository with thousands of them measured between 7.6 and 9.0
 * seconds here. Run synchronously on Electron's main process that is not a
 * slow list — it is nine seconds in which the window does not redraw, no other
 * IPC call is answered, and the app is indistinguishable from hung. Everything
 * that reaches the network and local Git reads use asynchronous subprocesses.
 */
function runAsync(
  command: string,
  args: string[],
  cwd: string,
  timeout = 12_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd });
    } catch {
      resolve({ ok: false, stdout: "", stderr: `Could not run ${command}.` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (result: { ok: boolean; stdout: string; stderr: string; }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, stdout, stderr: stderr.trim() || `${command} timed out.` });
    }, timeout);
    // Unref so a pending lookup cannot hold the app open at quit.
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 16 * 1024 * 1024) {
        child.kill();
        finish({ ok: false, stdout: "", stderr: "The command response is too large to display." });
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (!settled) stderr = (stderr + chunk).slice(-16_384);
    });
    child.on("error", (error: Error) => finish({ ok: false, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, stdout, stderr: stderr.trim() }));
  });
}

/*
 * Whether `gh` exists, asked once.
 *
 * enrichGitStatus runs on every git refresh and this spawned a process each
 * time to ask a question whose answer is fixed for the life of the app.
 */
let ghPresent: boolean | undefined;
let ghProbe: Promise<boolean> | undefined;

const pullRequestCache = new Map<string, { value?: GitPullRequest; at: number; }>();
const pullRequestAttempts = new Map<string, number>();

export async function ghAvailable(): Promise<boolean> {
  if (ghPresent === undefined) {
    ghProbe ??= runAsync("gh", ["--version"], process.cwd(), 1500).then((result) => result.ok);
    const pending = ghProbe;
    const available = await pending;
    if (ghProbe === pending) ghPresent = available;
    return available;
  }
  return ghPresent;
}

/** Forgets the cached answer, for a Doctor run that re-checks the environment. */
export function clearGhCache(): void {
  ghPresent = undefined;
  ghProbe = undefined;
  pullRequestCache.clear();
  pullRequestAttempts.clear();
  pullRequestListCache.clear();
  pullRequestListInFlight.clear();
  pullRequestListFailures.clear();
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

export async function lastCommitSubject(cwd: string): Promise<string> {
  return (await run("git", ["log", "-1", "--pretty=%s"], cwd, 4000)).stdout.trim();
}

export async function pushCurrentBranch(
  cwd: string,
  forceWithLease: boolean,
): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(cwd, async () => {

    const result = await runAsync("git", pushArgs(forceWithLease), cwd, 30_000);
    if (result.ok) return { ok: true, detail: result.stdout.trim() || "Pushed." };
    return { ok: false, detail: result.stderr || result.stdout.trim() || "Push failed." };

  });
}

function checkRollup(
  value: unknown,
): GitPullRequest["checks"] {
  if (!Array.isArray(value) || value.length === 0) return "none";
  const states = value.map((item) =>
    String((item as { state?: string; conclusion?: string; }).state ?? (item as { conclusion?: string; }).conclusion ?? "")
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

/*
 * GitHub reports two kinds of check against a commit: a CheckRun from Actions
 * and the like, which carries a status and then a conclusion, and the older
 * StatusContext, which carries a single state. Both arrive in the same array.
 */
function checkState(item: Record<string, unknown>): GitPullRequestCheck["state"] {
  const status = String(item.status ?? "").toUpperCase();
  const raw = String(item.conclusion ?? item.state ?? "").toUpperCase();
  // A run that has not finished has no conclusion yet, whatever it will be.
  if (status && status !== "COMPLETED" && !raw) return "pending";
  switch (raw) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
    case "ACTION_REQUIRED":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "NEUTRAL":
      return "neutral";
    case "CANCELLED":
      return "cancelled";
    case "PENDING":
    case "EXPECTED":
    case "QUEUED":
    case "IN_PROGRESS":
      return "pending";
    default:
      return status === "COMPLETED" ? "neutral" : "pending";
  }
}

/**
 * The checks, one per name, most recent run wins.
 *
 * A branch pushed twice has two runs of the same check in the rollup, and
 * counting both makes "17 of 27 passing" a number that matches nothing anyone
 * can see. The newest run is the one that is true now.
 */
/**
 * Labels with the colour the repository assigned them.
 *
 * The name alone was kept and the colour dropped, so every label rendered the
 * same grey — which is the whole point of a label thrown away. A plain string
 * is still accepted, since that is what older callers pass.
 */
export function parseLabels(value: unknown): GitPullRequestLabel[] {
  if (!Array.isArray(value)) return [];
  const labels: GitPullRequestLabel[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry) labels.push({ name: entry });
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    if (!name) continue;
    // GitHub stores six hex digits with no "#". Anything else is not a colour
    // we can trust into a stylesheet.
    const raw = typeof item.color === "string" ? item.color.replace(/^#/, "") : "";
    const color = /^[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : undefined;
    const description = typeof item.description === "string" && item.description
      ? item.description
      : undefined;
    labels.push({ name, ...(color ? { color } : {}), ...(description ? { description } : {}) });
  }
  return labels;
}

export function parseChecks(value: unknown): GitPullRequestCheck[] {
  if (!Array.isArray(value)) return [];
  const latest = new Map<string, GitPullRequestCheck>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const name =
      (typeof item.name === "string" && item.name) ||
      (typeof item.context === "string" && item.context) ||
      "";
    if (!name) continue;
    const workflow = typeof item.workflowName === "string" ? item.workflowName : undefined;
    const check: GitPullRequestCheck = {
      name,
      ...(workflow ? { workflow } : {}),
      state: checkState(item),
      ...(typeof item.detailsUrl === "string" && item.detailsUrl
        ? { url: item.detailsUrl }
        : typeof item.targetUrl === "string" && item.targetUrl
          ? { url: item.targetUrl }
          : {}),
      ...(typeof item.startedAt === "string" ? { startedAt: item.startedAt } : {}),
      ...(typeof item.completedAt === "string" ? { completedAt: item.completedAt } : {}),
    };
    const key = `${workflow ?? ""}\u0000${name}`;
    const previous = latest.get(key);
    const when = check.completedAt ?? check.startedAt ?? "";
    const before = previous?.completedAt ?? previous?.startedAt ?? "";
    if (!previous || when >= before) latest.set(key, check);
  }
  return [...latest.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parsePullRequestList(raw: string): GitPullRequest[] | undefined {
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
      author?: { login?: string; name?: string; };
      headRefName?: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
    if (!Array.isArray(rows) || rows.some((row) =>
      !row || typeof row !== "object" || !Number.isInteger(row.number) ||
      (row.number ?? 0) < 1 || typeof row.url !== "string" || !row.url
    )) return undefined;
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
    return undefined;
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
/*
 * The list, served from the last reading and refreshed behind it.
 *
 * `gh pr list` on a busy repository takes about ten seconds, and this ran on
 * every visit to the review pane — so opening it was a ten second wait, and
 * opening it again a minute later was another one. The answer changes on the
 * scale of minutes; showing the last one immediately and replacing it when the
 * new one lands is both faster and no less true.
 */
const PR_LIST_TTL_MS = 120_000;
const pullRequestListCache = new Map<string, { value: GitPullRequest[]; at: number; }>();
const pullRequestListFailures = new Map<string, string>();
/*
 * The call itself, not a flag saying one is happening. Two callers arriving
 * together must share the one `gh pr list` — a flag let the second start its
 * own, so the first look ran the ten second command twice at once.
 */
const pullRequestListInFlight = new Map<string, Promise<GitPullRequest[] | undefined>>();

function refreshPullRequestList(cwd: string): Promise<GitPullRequest[] | undefined> {
  const existing = pullRequestListInFlight.get(cwd);
  if (existing) return existing;
  const started = listPullRequests(cwd)
    .catch(() => undefined)
    .then((next) => {
      pullRequestListInFlight.delete(cwd);
      // A failed lookup must not erase a list that is merely old: a moment
      // offline should not empty the pane.
      if (next) onPullRequestSettled?.();
      return next;
    });
  pullRequestListInFlight.set(cwd, started);
  return started;
}

/**
 * The list as last known, refreshing behind the answer.
 *
 * `known` is false until a reading has landed, so a caller can tell "not
 * fetched yet" from "this repository has no open pull requests" and wait for
 * `pending` rather than showing an empty pane.
 */
export function pollPullRequestList(cwd: string, force = false): {
  value?: GitPullRequest[];
  known: boolean;
  stale: boolean;
  pending?: Promise<GitPullRequest[] | undefined>;
} {
  const cached = pullRequestListCache.get(cwd);
  const fresh = cached && Date.now() - cached.at < PR_LIST_TTL_MS;
  const pending = fresh && !force ? undefined : refreshPullRequestList(cwd);
  return {
    value: cached?.value,
    known: Boolean(cached),
    stale: Boolean(cached) && !fresh,
    ...(pending ? { pending } : {}),
  };
}

export async function listPullRequests(cwd: string): Promise<GitPullRequest[] | undefined> {
  const result = await readGhJson(
    [
      "pr",
      "list",
      "--limit",
      "50",
      "--json",
      "number,url,title,isDraft,state,author,headRefName,createdAt,updatedAt",
    ],
    cwd,
    parsePullRequestList,
    runAsync,
    30_000,
  );
  if (result.value === undefined) {
    pullRequestListFailures.set(cwd, listFailureReason(result.error));
    return undefined;
  }
  pullRequestListFailures.delete(cwd);
  const parsed = result.value;
  pullRequestListCache.set(cwd, { value: parsed, at: Date.now() });
  return parsed;
}

/** Why the last listing for `cwd` failed, if the last one did. */
export function pullRequestListFailure(cwd: string): string | undefined {
  return pullRequestListFailures.get(cwd);
}

function actorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as { login?: unknown; name?: unknown; };
  if (typeof actor.login === "string" && actor.login) return actor.login;
  return typeof actor.name === "string" && actor.name ? actor.name : undefined;
}

/**
 * Why the pull request list came back empty-handed, in plain language.
 *
 * The review pane said "GitHub could not be reached. Check that `gh` is signed
 * in, then refresh." for every failure, whatever it was — so a folder with no
 * GitHub remote at all, which is not a sign-in problem and cannot be fixed by
 * refreshing, sent people to look at their credentials.
 */
export function listFailureReason(stderr: string): string {
  const text = stderr.trim();
  if (isIncompleteResponse(text)) return INCOMPLETE_GITHUB_RESPONSE;
  if (/no git remotes found|not a git repository/i.test(text)) {
    return "This folder has no GitHub remote, so there are no pull requests to show.";
  }
  // Checked before the repository case, whose wording would otherwise claim a
  // missing `gh` binary ("executable file not found") was a missing repository.
  if (/executable file not found|ENOENT|command not found/i.test(text)) {
    return "The `gh` command is not installed, so pull requests cannot be listed.";
  }
  if (/could not resolve( to)? a repository|no such repository|repository not found/i.test(text)) {
    return "GitHub does not have a repository for this folder's remote.";
  }
  if (/authentication|not logged in|gh auth login|401|bad credentials/i.test(text)) {
    return "`gh` is not signed in to GitHub. Run `gh auth login`, then refresh.";
  }
  if (/rate limit/i.test(text)) {
    return "GitHub is rate limiting this machine. Wait a few minutes, then refresh.";
  }
  if (/403|forbidden|resource not accessible/i.test(text)) {
    return "GitHub denied access. Check this account's repository permissions, then refresh.";
  }
  if (/timed out|dial tcp|network is unreachable|no such host|connection refused|error connecting/i.test(text)) {
    return "GitHub could not be reached. Check your connection, then refresh.";
  }
  /*
   * GitHub's own trouble, not the user's. It answers these with a paragraph
   * apologising and linking its GraphQL endpoint, which is not something to
   * put in a side panel — and nothing here needs fixing, only retrying.
   */
  if (/HTTP 5\d\d|bad gateway|service unavailable|internal server error/i.test(text)) {
    return "GitHub is having trouble right now. Try again in a moment.";
  }
  return text ? text.split("\n").filter(Boolean)[0]! : "Pull requests could not be listed.";
}

export function diffFailureReason(stderr: string): string {
  const text = stderr.trim();
  if (isIncompleteResponse(text)) return INCOMPLETE_GITHUB_RESPONSE;
  if (/maximum number of files/i.test(text) || /too_large/i.test(text)) {
    return "GitHub does not render a diff for a pull request this large.";
  }
  if (/timed out/i.test(text)) return "GitHub did not return the diff in time.";
  if (!text) return "GitHub returned no diff for this pull request.";
  // The last line of gh's output is the message; the rest is its own framing.
  return text.split("\n").filter(Boolean).at(-1) ?? text;
}

/** Parse the `gh pr view --json` shape without trusting optional host fields. */
export function parsePullRequestDetail(
  raw: string,
  diff = "",
  diffUnavailable?: string,
): GitPullRequestDetail | undefined {
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
    const labels = parseLabels(row.labels);
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
      checkRuns: parseChecks(statusCheckRollup),
      ...(diffUnavailable ? { diffUnavailable } : {}),
      author: actorName(row.author),
      headRefName: typeof row.headRefName === "string" ? row.headRefName : undefined,
      baseRefName: typeof row.baseRefName === "string" ? row.baseRefName : undefined,
      mergedAt: typeof row.mergedAt === "string" ? row.mergedAt : undefined,
      closedAt: typeof row.closedAt === "string" ? row.closedAt : undefined,
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

export async function readPullRequestDetail(
  cwd: string,
  number: number,
): Promise<GitPullRequestDetail | undefined> {
  if (!Number.isInteger(number) || number < 1) return undefined;
  const fields = [
    "number", "url", "title", "body", "isDraft", "state", "mergeStateStatus",
    "reviewDecision", "statusCheckRollup", "author", "headRefName", "baseRefName", "createdAt", "updatedAt",
    "additions", "deletions", "changedFiles", "labels", "reviewRequests", "comments", "reviews",
    "commits", "files", "mergedAt", "closedAt",
  ].join(",");
  /*
   * Both at once. They are independent requests to GitHub, and running them
   * one after the other made opening a pull request cost the sum of the two —
   * about 2.2s here — where it need only cost the slower.
   */
  const [detail, patch] = await Promise.all([
    readGhJson(["pr", "view", String(number), "--json", fields], cwd, parsePullRequestDetail, runAsync, 20_000),
    runAsync("gh", ["pr", "diff", String(number), "--color=never"], cwd, 20_000),
  ]);
  if (!detail.value) throw new Error(listFailureReason(detail.error));
  const parsed = {
    ...detail.value,
    diff: patch.ok ? patch.stdout : "",
    ...(!patch.ok ? { diffUnavailable: diffFailureReason(patch.stderr) } : {}),
  };
  /*
   * Everyone the view will name: the author, whoever was asked to review, and
   * whoever wrote a comment or review. Fetched together, and failures are
   * simply missing keys.
   */
  const logins = [
    parsed.author,
    ...parsed.reviewers,
    ...parsed.activity.map((item) => item.author),
    ...parsed.commits.flatMap((commit) => commit.authors),
  ].filter((value): value is string => Boolean(value));
  return { ...parsed, avatars: await avatarsFor(logins) };
}

export function commitDiffArgs(oid: string): string[] {
  if (!/^[a-f0-9]{40}$/i.test(oid)) throw new Error("A full commit ID is required.");
  return ["api", `repos/{owner}/{repo}/commits/${oid}`, "--method", "GET", "-H", "Accept: application/vnd.github.diff"];
}

/** Resolve the repository from this checkout, never from renderer-supplied URLs. */
export async function readCommitDiff(cwd: string, oid: string): Promise<string> {
  const result = await runAsync("gh", commitDiffArgs(oid), cwd, 20_000);
  if (!result.ok) throw new Error(listFailureReason(result.stderr));
  if (result.stdout.trim() && !result.stdout.startsWith("diff --git ")) {
    throw new Error("GitHub returned an unreadable commit diff. Try refreshing again.");
  }
  return result.stdout;
}

export async function viewPullRequest(cwd: string): Promise<GitPullRequest | undefined> {
  const result = await readGhJson(
    [
      "pr",
      "view",
      "--json",
      "number,url,title,isDraft,state,mergeStateStatus,reviewDecision,statusCheckRollup",
    ],
    cwd,
    parseCurrentPullRequest,
    runAsync,
    12_000,
  );
  if (result.value) return result.value;
  if (/no pull requests? found/i.test(result.error)) return undefined;
  throw new Error(listFailureReason(result.error));
}

function parseCurrentPullRequest(raw: string): GitPullRequest | undefined {
  try {
    const parsed = JSON.parse(raw) as {
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
            const row = item as { name?: string; state?: string; conclusion?: string; };
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
  const attempted = pullRequestAttempts.get(cwd);
  if (attempted !== undefined && Date.now() - attempted < PR_CACHE_TTL_MS) return cached?.value;
  if (!pullRequestInFlight.has(cwd)) {
    pullRequestInFlight.add(cwd);
    pullRequestAttempts.set(cwd, Date.now());
    /*
     * Off the current tick and off the thread. This used to be a setImmediate
     * around a synchronous spawn, on the reasoning that nothing was waiting on
     * the answer — but a blocking spawn on the main process is not waited on
     * by one caller, it is waited on by everything, so a refresh nobody asked
     * for still froze the window for the length of a network round trip.
     */
    void viewPullRequest(cwd)
      .then((next) => {
        const previous = pullRequestCache.get(cwd)?.value;
        pullRequestCache.set(cwd, { value: next, at: Date.now() });
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          onPullRequestSettled?.();
        }
      })
      // Failure neither erases a prior reading nor marks an unknown PR as absent.
      .catch(() => undefined)
      .finally(() => pullRequestInFlight.delete(cwd));
  }
  return cached?.value;
}

/**
 * The pull request as last known, refreshing behind the answer.
 *
 * For a caller that polls: the watcher used to run `gh pr view` itself, and
 * that call reaches GitHub — about a second, synchronously, on the main
 * process, every forty-five seconds for as long as watching is on. `known` is
 * false until a reading has actually landed, so a caller cannot read "not
 * fetched yet" as "there is no pull request".
 */
export function pollPullRequest(cwd: string): { value?: GitPullRequest; known: boolean; } {
  const value = cachedPullRequest(cwd);
  return { value, known: pullRequestCache.has(cwd) };
}

export async function enrichGitStatus(status: GitStatus, cwd?: string): Promise<GitStatus> {
  return inRepository(cwd, async () => {

    if (!status.isRepo || !cwd) return { ...status, ghAvailable: false };
    const available = await ghAvailable();
    const ahead = await run("git", ["rev-list", "--count", "@{upstream}..HEAD"], cwd, 3000);
    const behind = await run("git", ["rev-list", "--count", "HEAD..@{upstream}"], cwd, 3000);
    return {
      ...status,
      ghAvailable: available,
      ahead: ahead.ok ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : undefined,
      behind: behind.ok ? Number.parseInt(behind.stdout.trim(), 10) || 0 : undefined,
      pullRequest: available ? cachedPullRequest(cwd) : undefined,
    };

  }, JSON.stringify(["enrichGitStatus", status, cwd]));
}

export async function createPullRequest(
  cwd: string,
  input: { title: string; body: string; draft: boolean; },
): Promise<{ ok: boolean; detail: string; url?: string; }> {
  return inRepository(cwd, async () => {

    const result = await runAsync("gh", createPullRequestArgs(input), cwd, 30_000);
    const text = `${result.stdout}\n${result.stderr}`.trim();
    const url = text.match(/https:\/\/github\.com\/\S+/)?.[0];
    if (result.ok) return { ok: true, detail: text || "Opened pull request.", url };
    return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not create pull request." };

  });
}

export async function mergePullRequest(
  cwd: string,
  method: PrMergeMethod,
  auto: boolean,
): Promise<{ ok: boolean; detail: string; }> {
  return inRepository(cwd, async () => {

    const result = await runAsync("gh", mergePullRequestArgs(method, auto), cwd, 30_000);
    if (result.ok) return { ok: true, detail: result.stdout.trim() || "Merge started." };
    return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not merge pull request." };

  });
}

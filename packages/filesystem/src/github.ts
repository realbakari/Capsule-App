import { spawn, spawnSync } from "node:child_process";
import type {
  GitPullRequest,
  GitPullRequestActivity,
  GitPullRequestCheck,
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
 * The same, without stopping the world.
 *
 * `gh` reaches GitHub, and on a busy repository it is not quick: listing pull
 * requests on a repository with thousands of them measured between 7.6 and 9.0
 * seconds here. Run synchronously on Electron's main process that is not a
 * slow list — it is nine seconds in which the window does not redraw, no other
 * IPC call is answered, and the app is indistinguishable from hung. Everything
 * that reaches the network goes through this instead; `run` above stays for
 * the local git questions, which are milliseconds.
 */
function runAsync(
  command: string,
  args: string[],
  cwd: string,
  timeout = 12_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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
    let settled = false;
    const finish = (result: { ok: boolean; stdout: string; stderr: string }) => {
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
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
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
  pullRequestListCache.clear();
  pullRequestListInFlight.clear();
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

export async function pushCurrentBranch(
  cwd: string,
  forceWithLease: boolean,
): Promise<{ ok: boolean; detail: string }> {
  const result = await runAsync("git", pushArgs(forceWithLease), cwd, 30_000);
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
const pullRequestListCache = new Map<string, { value: GitPullRequest[]; at: number }>();
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
export function pollPullRequestList(cwd: string): {
  value?: GitPullRequest[];
  known: boolean;
  stale: boolean;
  pending?: Promise<GitPullRequest[] | undefined>;
} {
  const cached = pullRequestListCache.get(cwd);
  const fresh = cached && Date.now() - cached.at < PR_LIST_TTL_MS;
  const pending = fresh ? undefined : refreshPullRequestList(cwd);
  return {
    value: cached?.value,
    known: Boolean(cached),
    stale: Boolean(cached) && !fresh,
    ...(pending ? { pending } : {}),
  };
}

export async function listPullRequests(cwd: string): Promise<GitPullRequest[] | undefined> {
  const result = await runAsync(
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
  if (!result.ok) return undefined;
  const parsed = parsePullRequestList(result.stdout);
  pullRequestListCache.set(cwd, { value: parsed, at: Date.now() });
  return parsed;
}

function actorName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as { login?: unknown; name?: unknown };
  if (typeof actor.login === "string" && actor.login) return actor.login;
  return typeof actor.name === "string" && actor.name ? actor.name : undefined;
}

/** Parse the `gh pr view --json` shape without trusting optional host fields. */
/**
 * Why `gh pr diff` produced nothing, said plainly.
 *
 * The common case by far is GitHub's own ceiling: it will not render a diff of
 * more than three hundred files, and answers 406 rather than truncating.
 */
export function diffFailureReason(stderr: string): string {
  const text = stderr.trim();
  if (/maximum number of files/i.test(text) || /too_large/i.test(text)) {
    return "GitHub does not render a diff for a pull request this large.";
  }
  if (/timed out/i.test(text)) return "GitHub did not return the diff in time.";
  if (!text) return "GitHub returned no diff for this pull request.";
  // The last line of gh's output is the message; the rest is its own framing.
  return text.split("\n").filter(Boolean).at(-1) ?? text;
}

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
      checkRuns: parseChecks(statusCheckRollup),
      ...(diffUnavailable ? { diffUnavailable } : {}),
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

export async function readPullRequestDetail(
  cwd: string,
  number: number,
): Promise<GitPullRequestDetail | undefined> {
  if (!Number.isInteger(number) || number < 1) return undefined;
  const fields = [
    "number", "url", "title", "body", "isDraft", "state", "mergeStateStatus",
    "reviewDecision", "statusCheckRollup", "author", "headRefName", "baseRefName", "createdAt", "updatedAt",
    "additions", "deletions", "changedFiles", "labels", "reviewRequests", "comments", "reviews",
    "commits", "files",
  ].join(",");
  /*
   * Both at once. They are independent requests to GitHub, and running them
   * one after the other made opening a pull request cost the sum of the two —
   * about 2.2s here — where it need only cost the slower.
   */
  const [detail, patch] = await Promise.all([
    runAsync("gh", ["pr", "view", String(number), "--json", fields], cwd, 20_000),
    runAsync("gh", ["pr", "diff", String(number), "--color=never"], cwd, 20_000),
  ]);
  if (!detail.ok || !detail.stdout.trim()) return undefined;
  return parsePullRequestDetail(
    detail.stdout,
    patch.ok ? patch.stdout : "",
    patch.ok ? undefined : diffFailureReason(patch.stderr),
  );
}

export async function viewPullRequest(cwd: string): Promise<GitPullRequest | undefined> {
  const result = await runAsync(
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
    /*
     * Off the current tick and off the thread. This used to be a setImmediate
     * around a synchronous spawn, on the reasoning that nothing was waiting on
     * the answer — but a blocking spawn on the main process is not waited on
     * by one caller, it is waited on by everything, so a refresh nobody asked
     * for still froze the window for the length of a network round trip.
     */
    void viewPullRequest(cwd)
      .catch(() => undefined)
      .then((next) => {
        pullRequestInFlight.delete(cwd);
        const previous = pullRequestCache.get(cwd)?.value;
        pullRequestCache.set(cwd, { value: next, at: Date.now() });
        if (previous?.number !== next?.number || previous?.state !== next?.state) {
          onPullRequestSettled?.();
        }
      });
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
export function pollPullRequest(cwd: string): { value?: GitPullRequest; known: boolean } {
  const value = cachedPullRequest(cwd);
  return { value, known: pullRequestCache.has(cwd) };
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

export async function createPullRequest(
  cwd: string,
  input: { title: string; body: string; draft: boolean },
): Promise<{ ok: boolean; detail: string; url?: string }> {
  const result = await runAsync("gh", createPullRequestArgs(input), cwd, 30_000);
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const url = text.match(/https:\/\/github\.com\/\S+/)?.[0];
  if (result.ok) return { ok: true, detail: text || "Opened pull request.", url };
  return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not create pull request." };
}

export async function mergePullRequest(
  cwd: string,
  method: PrMergeMethod,
  auto: boolean,
): Promise<{ ok: boolean; detail: string }> {
  const result = await runAsync("gh", mergePullRequestArgs(method, auto), cwd, 30_000);
  if (result.ok) return { ok: true, detail: result.stdout.trim() || "Merge started." };
  return { ok: false, detail: result.stderr || result.stdout.trim() || "Could not merge pull request." };
}

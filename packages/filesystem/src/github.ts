import { spawnSync } from "node:child_process";
import type { GitPullRequest, GitStatus, PrMergeMethod } from "@capsule/shared";

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

export function ghAvailable(): boolean {
  const result = spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 1500 });
  return result.status === 0;
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
    pullRequest: available ? viewPullRequest(cwd) : undefined,
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

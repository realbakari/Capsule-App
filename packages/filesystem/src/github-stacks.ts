import type {
  GitPullRequest,
  GitPullRequestStack,
  GitPullRequestStackAction,
  GitPullRequestStackHead,
  GitPullRequestStackLayer,
  GitPullRequestStackMembership,
  PrMergeMethod,
} from "@capsule/shared";
import type { ReadCommand } from "./github-read.js";

const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const HEAD_SHA = /^[a-f0-9]{7,64}$/i;
const MEMBERSHIP_CHUNK = 25;
const STACK_READ_TIMEOUT_MS = 12_000;
const MERGE_POLL_TIMEOUT_MS = 20_000;
const MERGE_DEADLINE_MS = 5 * 60_000;

export interface GithubRepoRef {
  host: string;
  owner: string;
  repo: string;
}

export function githubRepoFromPullRequestUrl(url?: string): GithubRepoRef | undefined {
  if (!url) return undefined;
  const match = url.trim().match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+(?:\/|$)/i);
  if (!match) return undefined;
  const host = match[1]!.toLowerCase().replace(/^www\./, "");
  const owner = match[2]!;
  const repo = match[3]!.replace(/\.git$/i, "");
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo) || owner === "." || owner === "..") {
    return undefined;
  }
  return { host, owner, repo };
}

export function isGithubDotCom(host: string): boolean {
  return host === "github.com";
}

export function stackLayerLabel(stack: GitPullRequestStackMembership): string {
  return `${stack.position}/${stack.size}`;
}

/** Open layers from the base through `number`, which is what a stack merge lands. */
export function mergeLayersThrough(
  stack: GitPullRequestStack,
  number: number,
): GitPullRequestStackLayer[] | undefined {
  const index = stack.layers.findIndex((layer) => layer.number === number);
  if (index < 0) return undefined;
  const slice = stack.layers.slice(0, index + 1);
  if (slice.some((layer) => normalizeLayerState(layer.state) !== "open" || layer.isDraft)) {
    return undefined;
  }
  return slice;
}

export function githubRepoFromRemote(stdout: string): GithubRepoRef | undefined {
  for (const line of stdout.split("\n")) {
    const https = line.match(/https:\/\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/i);
    if (https) {
      const ref = {
        host: https[1]!.toLowerCase().replace(/^www\./, ""),
        owner: https[2]!,
        repo: https[3]!.replace(/\.git$/i, ""),
      };
      if (GITHUB_NAME.test(ref.owner) && GITHUB_NAME.test(ref.repo) && ref.owner !== "." && ref.owner !== "..") {
        return ref;
      }
    }
    const ssh = line.match(/(?:git@|ssh:\/\/git@)([^:/]+)[:/]([^/]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/i);
    if (ssh) {
      const ref = {
        host: ssh[1]!.toLowerCase(),
        owner: ssh[2]!,
        repo: ssh[3]!.replace(/\.git$/i, ""),
      };
      if (GITHUB_NAME.test(ref.owner) && GITHUB_NAME.test(ref.repo) && ref.owner !== "." && ref.owner !== "..") {
        return ref;
      }
    }
  }
  return undefined;
}

export function sameGithubRepo(left: GithubRepoRef, right: GithubRepoRef): boolean {
  return left.host === right.host
    && left.owner.toLowerCase() === right.owner.toLowerCase()
    && left.repo.toLowerCase() === right.repo.toLowerCase();
}

async function checkoutGithubRepos(cwd: string, run: ReadCommand): Promise<GithubRepoRef[]> {
  const remotes = await run("git", ["remote", "-v"], cwd, 3_000);
  if (!remotes.ok) return [];
  return remotes.stdout.split("\n").flatMap((line) => {
    const repo = githubRepoFromRemote(line);
    return repo ? [repo] : [];
  });
}

async function stackWriteRepo(
  cwd: string,
  actionUrl: string,
  run: ReadCommand,
): Promise<GithubRepoRef | { ok: false; detail: string; }> {
  const claimed = githubRepoFromPullRequestUrl(actionUrl);
  const remotes = await checkoutGithubRepos(cwd, run);
  if (!claimed || !isGithubDotCom(claimed.host) || !remotes.some((remote) => sameGithubRepo(claimed, remote))) {
    return { ok: false, detail: "This stack does not belong to this folder's GitHub remote." };
  }
  // The selected PR determines the repository. Every subsequent request uses
  // this exact identity, independent of gh's default remote or environment.
  return claimed;
}

export function isTopStackLayer(stack: GitPullRequestStack, number: number): boolean {
  const top = stack.layers.at(-1);
  return top?.number === number;
}

export function expectedHeadsFromLayers(
  layers: readonly GitPullRequestStackLayer[],
): GitPullRequestStackHead[] | undefined {
  const heads: GitPullRequestStackHead[] = [];
  for (const layer of layers) {
    if (normalizeLayerState(layer.state) !== "open") continue;
    if (!layer.headSha || !HEAD_SHA.test(layer.headSha)) return undefined;
    heads.push({ number: layer.number, headSha: layer.headSha });
  }
  return heads.length > 0 ? heads : undefined;
}

export function headsMatch(
  expected: readonly GitPullRequestStackHead[],
  layers: readonly GitPullRequestStackLayer[],
): boolean {
  const open = layers.filter((layer) => normalizeLayerState(layer.state) === "open");
  if (expected.length !== open.length) return false;
  const seen = new Set<number>();
  for (const head of expected) {
    if (seen.has(head.number) || !HEAD_SHA.test(head.headSha)) return false;
    seen.add(head.number);
    const layer = open.find((item) => item.number === head.number);
    if (!layer?.headSha || layer.headSha.toLowerCase() !== head.headSha.toLowerCase()) return false;
  }
  return true;
}

export function stackMembershipQuery(
  repo: GithubRepoRef,
  numbers: readonly number[],
): string | undefined {
  if (!isGithubDotCom(repo.host) || !GITHUB_NAME.test(repo.owner) || !GITHUB_NAME.test(repo.repo)) {
    return undefined;
  }
  const aliases: string[] = [];
  for (const [index, number] of numbers.entries()) {
    if (!Number.isInteger(number) || number < 1) return undefined;
    aliases.push(
      `s${index}: repository(owner: "${repo.owner}", name: "${repo.repo}") { pullRequest(number: ${number}) { stack { number size baseRefName } stackEntry { position } } }`,
    );
  }
  if (aliases.length === 0) return undefined;
  return `query PullRequestStackMemberships { ${aliases.join(" ")} }`;
}

export function parseStackMembershipsJson(
  raw: string,
  numbers: readonly number[],
): Map<number, GitPullRequestStackMembership> {
  const memberships = new Map<number, GitPullRequestStackMembership>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return memberships;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return memberships;
  const data = (parsed as { data?: unknown; }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return memberships;
  const rows = data as Record<string, unknown>;
  for (const [index, number] of numbers.entries()) {
    const node = rows[`s${index}`];
    const membership = membershipFromNode(node);
    if (membership) memberships.set(number, membership);
  }
  return memberships;
}

export function parsePullRequestStacksJson(raw: string): GitPullRequestStack | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  return parseStackRow(row);
}

export function mergeStackArgs(
  repo: GithubRepoRef,
  number: number,
  method: PrMergeMethod,
  sha: string,
): string[] {
  if (!Number.isInteger(number) || number < 1 || !HEAD_SHA.test(sha)) {
    throw new Error("Select a stacked pull request before merging.");
  }
  return [
    "api",
    "--hostname",
    repo.host,
    "--method",
    "PUT",
`repos/${repo.owner}/${repo.repo}/pulls/${number}/merge-async`,
    "-f",
    `merge_method=${method}`,
    "-f",
    "merge_action=default",
    "-f",
    `sha=${sha}`,
  ];
}

export function mergeStackPollArgs(repo: GithubRepoRef, number: number, uuid: string): string[] {
  if (!Number.isInteger(number) || number < 1 || !/^[A-Za-z0-9_-]+$/.test(uuid)) {
    throw new Error("The merge could not be tracked.");
  }
  return [
    "api",
    "--hostname",
    repo.host,
    `repos/${repo.owner}/${repo.repo}/pulls/${number}/merge-async/${uuid}`,
  ];
}

export async function enrichPullRequestsWithStacks(
  cwd: string,
  items: GitPullRequest[],
  run: ReadCommand,
): Promise<GitPullRequest[]> {
  const repo = githubRepoFromPullRequestUrl(items[0]?.url);
  if (!repo || !isGithubDotCom(repo.host) || items.length === 0) return items;
  if (items.some((item) => githubRepoFromPullRequestUrl(item.url)?.repo !== repo.repo)) return items;
  try {
    const memberships = new Map<number, GitPullRequestStackMembership>();
    for (let start = 0; start < items.length; start += MEMBERSHIP_CHUNK) {
      const chunk = items.slice(start, start + MEMBERSHIP_CHUNK);
      const numbers = chunk.map((item) => item.number);
      const query = stackMembershipQuery(repo, numbers);
      if (!query) return items;
      const result = await run(
        "gh",
        ["api", "--hostname", repo.host, "graphql", "-f", `query=${query}`],
        cwd,
        STACK_READ_TIMEOUT_MS,
      );
      if (!result.ok) continue;
      for (const [number, membership] of parseStackMembershipsJson(result.stdout, numbers)) {
        memberships.set(number, membership);
      }
    }
    if (memberships.size === 0) return items;
    return items.map((item) => {
      const stack = memberships.get(item.number);
      return stack && stack.size >= 2 ? { ...item, stack } : item;
    });
  } catch {
    return items;
  }
}

export async function readPullRequestStack(
  cwd: string,
  url: string,
  number: number,
  run: ReadCommand,
): Promise<GitPullRequestStack | undefined> {
  const repo = githubRepoFromPullRequestUrl(url);
  if (!repo || !isGithubDotCom(repo.host) || !Number.isInteger(number) || number < 1) return undefined;
  try {
    const listed = await run(
      "gh",
      ["api", "--hostname", repo.host, `repos/${repo.owner}/${repo.repo}/stacks?pull_request=${number}`],
      cwd,
      STACK_READ_TIMEOUT_MS,
    );
    if (!listed.ok) return undefined;
    const summary = parsePullRequestStacksJson(listed.stdout);
    if (!summary || summary.layers.length < 2) return undefined;
    const detailed = await run(
      "gh",
      ["api", "--hostname", repo.host, `repos/${repo.owner}/${repo.repo}/stacks/${summary.number}`],
      cwd,
      STACK_READ_TIMEOUT_MS,
    );
    if (!detailed.ok) return summary;
    return parsePullRequestStacksJson(detailed.stdout) ?? summary;
  } catch {
    return undefined;
  }
}

export async function mergePullRequestStack(
  cwd: string,
  method: PrMergeMethod,
  action: GitPullRequestStackAction,
  run: ReadCommand,
): Promise<{ ok: boolean; detail: string; }> {
  const repo = await stackWriteRepo(cwd, action.url, run);
  if ("ok" in repo) return repo;
  const stack = await readPullRequestStack(cwd, action.url, action.number, run);
  const layers = stack ? mergeLayersThrough(stack, action.number) : undefined;
  if (!stack || !layers) {
    return { ok: false, detail: "This pull request is not part of a stack that can be merged." };
  }
  if (stack.number !== action.stackNumber || !headsMatch(action.heads, layers)) {
    return { ok: false, detail: "The stack changed. Refresh it before merging." };
  }
  const target = layers.find((layer) => layer.number === action.number);
  if (!target?.headSha) {
    return { ok: false, detail: "GitHub did not report a head revision for this stack layer." };
  }
  let request: { ok: boolean; stdout: string; stderr: string; };
  try {
    request = await run("gh", mergeStackArgs(repo, action.number, method, target.headSha), cwd, MERGE_POLL_TIMEOUT_MS);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Could not merge the stack." };
  }
  if (!request.ok) {
    return { ok: false, detail: mergeFailureReason(request.stderr || request.stdout) };
  }
  let status = parseMergeAsync(request.stdout);
  if (!status) return { ok: false, detail: "GitHub returned an unreadable stack merge response." };
  const deadline = Date.now() + MERGE_DEADLINE_MS;
  for (let attempt = 0; status.status === "pending" && Date.now() < deadline; attempt += 1) {
    if (!status.uuid) return { ok: false, detail: "GitHub did not return a merge identifier." };
    await sleep(Math.min(1_000 * 2 ** attempt, 10_000));
    const poll = await run("gh", mergeStackPollArgs(repo, action.number, status.uuid), cwd, MERGE_POLL_TIMEOUT_MS);
    if (!poll.ok) return { ok: false, detail: mergeFailureReason(poll.stderr || poll.stdout) };
    status = parseMergeAsync(poll.stdout);
    if (!status) return { ok: false, detail: "GitHub returned an unreadable stack merge response." };
  }
  if (status.status === "pending") {
    return { ok: false, detail: "The merge is still running on GitHub. Check its status there before trying again." };
  }
  if (status.status === "failed") {
    return { ok: false, detail: "GitHub refused the stack merge. Check branch rules and merge requirements." };
  }
  if (status.status === "merged") return { ok: true, detail: "The stack was merged." };
  if (status.status === "enqueued") return { ok: true, detail: "The stack was added to the merge queue." };
  return { ok: false, detail: `GitHub reported an unexpected merge status (${status.status}).` };
}

export async function rebasePullRequestStack(
  cwd: string,
  action: GitPullRequestStackAction,
  run: ReadCommand,
): Promise<{ ok: boolean; detail: string; }> {
  const repo = await stackWriteRepo(cwd, action.url, run);
  if ("ok" in repo) return repo;
  const stack = await readPullRequestStack(cwd, action.url, action.number, run);
  if (!stack || !isTopStackLayer(stack, action.number)) {
    return { ok: false, detail: "Rebase the stack from its top pull request." };
  }
  const open = stack.layers.filter((layer) => normalizeLayerState(layer.state) === "open");
  if (stack.number !== action.stackNumber || !headsMatch(action.heads, open)) {
    return { ok: false, detail: "The stack changed. Refresh it before rebasing." };
  }
  const access = await run(
    "gh",
    [
      "api",
      "--hostname",
      repo.host,
      "graphql",
      "-f",
      `query=${branchAccessQuery(repo, open)}`,
    ],
    cwd,
    STACK_READ_TIMEOUT_MS,
  );
  if (!access.ok || !viewerCanRebase(access.stdout, open)) {
    return { ok: false, detail: "You cannot update every branch in this stack. Check write access, then retry." };
  }
  let completed = 0;
  for (const layer of open) {
    const prepared = await readLayerForRebase(cwd, repo, layer, run);
    if (!prepared.ok) {
      return {
        ok: false,
        detail: completed > 0
          ? `Stack rebase stopped at PR #${layer.number} after ${completed} layers. Earlier updates remain on GitHub.`
          : prepared.detail,
      };
    }
    if (prepared.behindBy === 0) {
      completed += 1;
      continue;
    }
    const updated = await run(
      "gh",
      [
        "api",
        "--hostname",
        repo.host,
        "graphql",
        "-f",
        `id=${prepared.id}`,
        "-f",
        `sha=${layer.headSha}`,
        "-f",
        "query=mutation($id:ID!,$sha:GitObjectID!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$sha,updateMethod:REBASE}){pullRequest{headRefOid}}}",
      ],
      cwd,
      STACK_READ_TIMEOUT_MS,
    );
    if (!updated.ok) {
      return {
        ok: false,
        detail: `Stack rebase stopped at PR #${layer.number} after ${completed} layers. Earlier updates remain on GitHub; resolve that layer before retrying.`,
      };
    }
    completed += 1;
  }
  return { ok: true, detail: "Stack rebase started." };
}

function membershipFromNode(node: unknown): GitPullRequestStackMembership | undefined {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  const pull = (node as { pullRequest?: unknown; }).pullRequest;
  if (!pull || typeof pull !== "object" || Array.isArray(pull)) return undefined;
  const stack = (pull as { stack?: unknown; }).stack;
  const entry = (pull as { stackEntry?: unknown; }).stackEntry;
  if (!stack || typeof stack !== "object" || Array.isArray(stack)) return undefined;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const number = (stack as { number?: unknown; }).number;
  const size = (stack as { size?: unknown; }).size;
  const base = (stack as { baseRefName?: unknown; }).baseRefName;
  const position = (entry as { position?: unknown; }).position;
  if (!isPositiveInt(number) || !isPositiveInt(size) || size < 2 || !isPositiveInt(position)) return undefined;
  if (typeof base !== "string" || !base) return undefined;
  return { number, size, position, base };
}

function parseStackRow(row: unknown): GitPullRequestStack | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const item = row as Record<string, unknown>;
  const number = item.number;
  if (!isPositiveInt(number)) return undefined;
  const base = stackBase(item.base);
  if (!base) return undefined;
  const pullRequests = item.pull_requests;
  if (!Array.isArray(pullRequests) || pullRequests.length < 2) return undefined;
  const layers: GitPullRequestStackLayer[] = [];
  for (const entry of pullRequests) {
    const layer = parseStackLayer(entry);
    if (!layer) return undefined;
    layers.push(layer);
  }
  const url = typeof item.url === "string" && item.url ? item.url : undefined;
  return { number, base, layers, ...(url ? { url } : {}) };
}

function parseStackLayer(entry: unknown): GitPullRequestStackLayer | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const item = entry as Record<string, unknown>;
  const number = item.number;
  if (!isPositiveInt(number)) return undefined;
  const head = item.head && typeof item.head === "object" && !Array.isArray(item.head)
    ? item.head as Record<string, unknown>
    : undefined;
  const headBranch = typeof head?.ref === "string" ? head.ref : "";
  if (!headBranch) return undefined;
  const merged = typeof item.merged_at === "string" && item.merged_at;
  const state = merged ? "merged" : normalizeLayerState(typeof item.state === "string" ? item.state : "open");
  const title = typeof item.title === "string" && item.title ? item.title : undefined;
  const headSha = typeof head?.sha === "string" && HEAD_SHA.test(head.sha) ? head.sha : undefined;
  return {
    number,
    headBranch,
    state,
    ...(title ? { title } : {}),
    ...(typeof item.draft === "boolean" ? { isDraft: item.draft } : {}),
    ...(headSha ? { headSha } : {}),
  };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function stackBase(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ref = (value as { ref?: unknown; }).ref;
    if (typeof ref === "string" && ref) return ref;
  }
  return undefined;
}

function normalizeLayerState(state: string): "open" | "merged" | "closed" {
  const value = state.trim().toLowerCase();
  if (value === "merged") return "merged";
  if (value === "closed") return "closed";
  return "open";
}

function parseMergeAsync(raw: string): { status: string; uuid?: string; } | undefined {
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; details?: { uuid?: unknown; }; };
    if (typeof parsed.status !== "string") return undefined;
    const uuid = typeof parsed.details?.uuid === "string" ? parsed.details.uuid : undefined;
    return { status: parsed.status, ...(uuid ? { uuid } : {}) };
  } catch {
    return undefined;
  }
}

function mergeFailureReason(text: string): string {
  const line = text.trim().split("\n").filter(Boolean)[0] ?? "";
  if (/404|not found/i.test(line)) {
    return "GitHub does not support merging this stack from Capsule. Open it on GitHub instead.";
  }
  if (/403|forbidden|resource not accessible/i.test(line)) {
    return "GitHub denied the stack merge. Check this account's repository permissions.";
  }
  return line || "Could not merge the stack.";
}

function branchAccessQuery(repo: GithubRepoRef, layers: readonly GitPullRequestStackLayer[]): string {
  const fields = layers
    .map((layer) => `pr${layer.number}:pullRequest(number:${layer.number}){headRepository{viewerPermission} maintainerCanModify}`)
    .join(" ");
  return `query { repository(owner: "${repo.owner}", name: "${repo.repo}") { ${fields} } }`;
}

function viewerCanRebase(raw: string, layers: readonly GitPullRequestStackLayer[]): boolean {
  try {
    const parsed = JSON.parse(raw) as { data?: { repository?: Record<string, unknown> | null; }; };
    const repository = parsed.data?.repository;
    if (!repository) return false;
    return layers.every((layer) => {
      const pr = repository[`pr${layer.number}`];
      if (!pr || typeof pr !== "object" || Array.isArray(pr)) return false;
      const row = pr as {
        maintainerCanModify?: unknown;
        headRepository?: { viewerPermission?: unknown; } | null;
      };
      if (row.maintainerCanModify === true) return true;
      const permission = String(row.headRepository?.viewerPermission ?? "").toUpperCase();
      return permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE";
    });
  } catch {
    return false;
  }
}

async function readLayerForRebase(
  cwd: string,
  repo: GithubRepoRef,
  layer: GitPullRequestStackLayer,
  run: ReadCommand,
): Promise<{ ok: true; id: string; behindBy: number; } | { ok: false; detail: string; }> {
  if (!layer.headSha) return { ok: false, detail: "GitHub did not report a head revision for this stack layer." };
  const result = await run(
    "gh",
    [
      "api",
      "--hostname",
      repo.host,
      "graphql",
      "-f",
      `query=query($owner:String!,$name:String!,$number:Int!,$sha:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid baseRef{compare(headRef:$sha){behindBy}}}}}`,
      "-f",
      `owner=${repo.owner}`,
      "-f",
      `name=${repo.repo}`,
      "-F",
      `number=${layer.number}`,
      "-f",
      `sha=${layer.headSha}`,
    ],
    cwd,
    STACK_READ_TIMEOUT_MS,
  );
  if (!result.ok) return { ok: false, detail: result.stderr || "Could not read this stack layer." };
  try {
    const parsed = JSON.parse(result.stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            id?: unknown;
            headRefOid?: unknown;
            baseRef?: { compare?: { behindBy?: unknown; }; };
          };
        };
      };
    };
    const pr = parsed.data?.repository?.pullRequest;
    const id = typeof pr?.id === "string" ? pr.id : "";
    const head = typeof pr?.headRefOid === "string" ? pr.headRefOid : "";
    const behindBy = pr?.baseRef?.compare?.behindBy;
    if (!id || !head) return { ok: false, detail: "GitHub returned an unreadable stack layer." };
    if (head.toLowerCase() !== layer.headSha.toLowerCase()) {
      return { ok: false, detail: "The stack changed. Refresh it before rebasing." };
    }
    if (!Number.isInteger(behindBy)) return { ok: false, detail: "GitHub returned an unreadable stack layer." };
    return { ok: true, id, behindBy: behindBy as number };
  } catch {
    return { ok: false, detail: "GitHub returned an unreadable stack layer." };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

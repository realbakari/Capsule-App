import type { SkillCatalogEntry, SkillCatalogPage } from "@capsule/shared";

/**
 * Live skill catalog, read from GitHub.
 *
 * Why not skills.sh: every endpoint under https://skills.sh/api/v1 answers
 * 401 `authentication_required` without a Vercel OIDC token, and that token is
 * minted per-request for code running inside a Vercel deployment. A desktop app
 * on a user's machine has no way to obtain one, so the skills.sh API can never
 * serve this view. (`SkillsShClient` is still here for a host that does have a
 * token, but it is not what the directory reads.)
 *
 * GitHub is the source the `skills` CLI itself installs from, its REST API is
 * public, and raw.githubusercontent.com serves SKILL.md with no rate limit of
 * its own. Everything shown in the directory therefore comes from a live fetch:
 * skill names from the repository listing, descriptions from SKILL.md
 * frontmatter, star counts from the repository record. Nothing is invented — a
 * field we cannot read is left undefined and the UI omits it.
 */

export interface SkillRepoRef {
  owner: string;
  repo: string;
  /** Directory inside the repo that holds one folder per skill. */
  dir: string;
}

/**
 * Seed repositories. These are coordinates only — every name, description and
 * count rendered from them is fetched live. Each was verified to expose a
 * skills directory in this layout.
 */
export const SEED_SKILL_REPOS: SkillRepoRef[] = [
  { owner: "anthropics", repo: "skills", dir: "skills" },
  { owner: "addyosmani", repo: "agent-skills", dir: "skills" },
  { owner: "vercel-labs", repo: "skills", dir: "skills" },
];

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
// The unauthenticated budget is 60 requests an hour for the whole machine, and
// this catalog changes on the order of days, so a short TTL buys nothing and
// costs the budget.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DOC_CONCURRENCY = 8;

interface ContentEntry {
  name: string;
  path: string;
  type: string;
  html_url: string | null;
}

/** Pull `description:` out of SKILL.md YAML frontmatter. */
export function parseSkillDoc(markdown: string): { description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match?.[1]) return {};
  // Frontmatter values run to the end of the line; a following line that is
  // indented continues the value (YAML folded style), which long skill
  // descriptions use.
  const lines = match[1].split(/\r?\n/);
  let value: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const key = /^description:\s*(.*)$/.exec(line);
    if (!key) continue;
    value = (key[1] ?? "").trim();
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? "";
      if (!/^\s+\S/.test(next)) break;
      value = `${value} ${next.trim()}`.trim();
    }
    break;
  }
  if (!value) return {};
  // A block scalar writes the indicator on the key line (`description: |-`,
  // `description: >`, `>-`, `|2+` …) and the text on the lines below, which the
  // loop above has already folded in. Drop the indicator so it does not lead
  // the rendered description.
  value = value.replace(/^[|>][+-]?\d*\s*/, "").trim();
  const unquoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return { description: (unquoted?.[2] ?? value).trim() || undefined };
}

/** "https://github.com/o/r/tree/main/skills/pdf" -> "main". */
export function branchFromHtmlUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /\/tree\/([^/]+)\//.exec(url)?.[1];
}

/** Run `tasks` with at most `limit` in flight, preserving input order. */
async function pooled<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}

export class SkillCatalogClient {
  private cache?: SkillCatalogPage;
  private inFlight?: Promise<SkillCatalogPage>;

  constructor(
    private readonly repos: SkillRepoRef[] = SEED_SKILL_REPOS,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
    /**
     * Optional persistence. Without it the cache dies with the process, and a
     * dev restart or app relaunch spends another slice of the hourly budget.
     */
    private readonly store?: {
      read: () => SkillCatalogPage | undefined;
      write: (page: SkillCatalogPage) => void;
    },
  ) {
    const persisted = this.store?.read();
    if (persisted?.entries.length) this.cache = persisted;
  }

  private headers(): Record<string, string> {
    return { Accept: "application/vnd.github+json", "User-Agent": "capsule-desktop" };
  }

  private async json<T>(url: string, timeoutMs = 8000): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // 403 from an unauthenticated client is almost always the 60/hour limit.
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers?.get?.("x-ratelimit-reset") ?? 0);
        const when =
          reset > 0
            ? new Date(reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : undefined;
        throw new Error(
          when
            ? `GitHub rate limit reached (60/hour, unauthenticated) — resets at ${when}`
            : "GitHub rate limit reached (60/hour, unauthenticated)",
        );
      }
      throw new Error(`GitHub responded ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async loadRepo(ref: SkillRepoRef): Promise<SkillCatalogEntry[]> {
    const slug = `${ref.owner}/${ref.repo}`;
    // One API call per repo. Asking for repo metadata too (stars, default
    // branch) doubled the cost against an unauthenticated budget of 60 requests
    // an hour, which is shared by everything on the machine — enough app
    // restarts and the directory went empty. The branch is already encoded in
    // each entry's html_url, so it costs nothing to read it from there.
    const listing = await this.json<ContentEntry[]>(`${API}/repos/${slug}/contents/${ref.dir}`);
    if (!Array.isArray(listing)) throw new Error(`Unexpected listing for ${slug}`);
    const dirs = listing.filter((entry) => entry.type === "dir");
    const branch = branchFromHtmlUrl(dirs.find((entry) => entry.html_url)?.html_url) ?? "main";

    return pooled(dirs, DOC_CONCURRENCY, async (entry) => {
      const docPath = `${entry.path}/SKILL.md`;
      let description: string | undefined;
      try {
        // raw.githubusercontent.com is a CDN and is not billed against the API
        // rate limit, so descriptions are cheap even for a large repo.
        const res = await this.fetchImpl(`${RAW}/${slug}/${branch}/${docPath}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) description = parseSkillDoc(await res.text()).description;
      } catch {
        // A skill without a readable SKILL.md still exists; it just shows no
        // description rather than a placeholder one.
      }
      return {
        id: `${slug}/${entry.name}`,
        name: entry.name,
        source: slug,
        url: entry.html_url ?? `https://github.com/${slug}/tree/${branch}/${entry.path}`,
        description,
        docPath,
        ref: branch,
        origin: "github",
      } satisfies SkillCatalogEntry;
    });
  }

  /** Fetch every seed repo. Partial failures are reported, not hidden. */
  async catalog(force = false): Promise<SkillCatalogPage> {
    if (!force && this.cache && this.now() - this.cache.fetchedAt < CACHE_TTL_MS) return this.cache;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const settled = await Promise.allSettled(this.repos.map((ref) => this.loadRepo(ref)));
      const entries: SkillCatalogEntry[] = [];
      const errors: string[] = [];
      settled.forEach((result, index) => {
        const ref = this.repos[index];
        if (result.status === "fulfilled") {
          entries.push(...result.value);
        } else {
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push(`${ref?.owner}/${ref?.repo}: ${reason}`);
        }
      });
      entries.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
      const page: SkillCatalogPage = { entries, errors, fetchedAt: this.now() };

      if (entries.length > 0) {
        // Only cache a page that has content, so a failed load retries.
        this.cache = page;
        this.store?.write(page);
        return page;
      }

      // Everything failed. Showing an empty directory hides a catalog we
      // already have; serve the last good one and carry the errors so the UI
      // can say why it is stale.
      const stale = this.cache ?? this.store?.read();
      if (stale?.entries.length) {
        return { ...stale, errors: [...errors, ...(stale.errors ?? [])] };
      }
      return page;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  /**
   * Filter the live catalog. An empty query browses everything; `force` skips
   * the cache so a Refresh actually refetches.
   */
  async search(query: string, force = false): Promise<SkillCatalogPage> {
    const page = await this.catalog(force);
    const needle = query.trim().toLowerCase();
    if (!needle) return page;
    const entries = page.entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.source.toLowerCase().includes(needle) ||
        (entry.description ?? "").toLowerCase().includes(needle),
    );
    return { ...page, entries };
  }

  /** Read a skill's SKILL.md. `id` is "owner/repo/skill-name". */
  async readSkillDoc(id: string): Promise<string | undefined> {
    const page = await this.catalog();
    const entry = page.entries.find((candidate) => candidate.id === id);
    if (!entry?.docPath) return undefined;
    try {
      const res = await this.fetchImpl(`${RAW}/${entry.source}/${entry.ref ?? "main"}/${entry.docPath}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return await res.text();
    } catch {
      // Reported to the caller as "unavailable" rather than as fake content.
    }
    return undefined;
  }
}

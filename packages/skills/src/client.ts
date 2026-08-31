import type { Skill, SkillsShSearchResult, SkillsShSkillDetail } from "@capsule/shared";
import { PACKED_SKILLS } from "./packs.js";

/**
 * Client for the skills.sh API (https://skills.sh/docs/api).
 *
 * Endpoints used:
 *   GET /api/v1/skills              – Paginated leaderboard (view: all-time | trending | hot)
 *   GET /api/v1/skills/search       – Search by name/source/description (q, limit, owner)
 *   GET /api/v1/skills/curated      – Official first-party curated set
 *   GET /api/v1/skills/:source/:skill – Detail with files (SKILL.md etc.)
 *
 * All responses are JSON. Authentication is NOT optional: every endpoint above
 * answers 401 `authentication_required` without a Vercel OIDC token, and that
 * token is minted per-request for code running inside a Vercel deployment. A
 * desktop app on a user's machine cannot obtain one, so these calls only
 * succeed when a host supplies a token explicitly.
 *
 * The skill directory therefore reads from GitHub instead — see
 * `SkillCatalogClient` in ./github.ts. This client is kept for a host that does
 * have a token; its offline fallback returns bundled packed skills.
 */
export class SkillsShClient {
  private baseUrl = "https://skills.sh/api/v1";
  private token?: string;

  constructor(options?: { token?: string }) {
    this.token = options?.token ?? (typeof process !== "undefined" ? process.env.VERCEL_OIDC_TOKEN : undefined);
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Search skills on skills.sh API.
   * Endpoint: GET /api/v1/skills/search?q={query}&limit={limit}&owner={owner}
   * Response: { data: V1Skill[], query, searchType: "fuzzy"|"semantic", count, durationMs }
   */
  /**
   * Search skills.sh. Unlike the fallback path below, this reports failure:
   * a 401 means the token is missing or rejected, and the caller needs to say
   * so rather than show a shorter list with no explanation.
   */
  async searchStrict(query: string, limit = 50, owner?: string): Promise<SkillsShSearchResult[]> {
    if (!this.token) throw new Error("No skills.sh token configured");
    const trimmed = query.trim();
    let url = `${this.baseUrl}/skills/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    if (owner) url += `&owner=${encodeURIComponent(owner)}`;
    const res = await fetch(url, { headers: this.getHeaders(), signal: AbortSignal.timeout(8000) });
    if (res.status === 401) {
      throw new Error(
        "skills.sh rejected the token (401). It expects a Vercel OIDC token, which expires roughly every 12 hours.",
      );
    }
    if (res.status === 429) throw new Error("skills.sh rate limit reached (429)");
    if (!res.ok) throw new Error(`skills.sh responded ${res.status}`);
    const json = (await res.json()) as { data?: SkillsShSearchResult[] };
    return Array.isArray(json.data) ? json.data : [];
  }

  /** Leaderboard, reporting failure the same way as searchStrict. */
  async leaderboardStrict(
    view: "all-time" | "trending" | "hot" = "all-time",
    perPage = 50,
  ): Promise<SkillsShSearchResult[]> {
    if (!this.token) throw new Error("No skills.sh token configured");
    const res = await fetch(`${this.baseUrl}/skills?view=${view}&page=0&per_page=${perPage}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) {
      throw new Error(
        "skills.sh rejected the token (401). It expects a Vercel OIDC token, which expires roughly every 12 hours.",
      );
    }
    if (res.status === 429) throw new Error("skills.sh rate limit reached (429)");
    if (!res.ok) throw new Error(`skills.sh responded ${res.status}`);
    const json = (await res.json()) as { data?: SkillsShSearchResult[] };
    return Array.isArray(json.data) ? json.data : [];
  }

  async search(query: string, limit = 50, owner?: string): Promise<SkillsShSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return [];

    try {
      let url = `${this.baseUrl}/skills/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
      if (owner) url += `&owner=${encodeURIComponent(owner)}`;
      const res = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: SkillsShSearchResult[] };
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data;
        }
      }
    } catch {
      // Offline fallback: match locally packed skills
    }

    const needle = trimmed.toLowerCase();
    return PACKED_SKILLS.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.id.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.packName?.toLowerCase().includes(needle) ||
        s.source.toLowerCase().includes(needle) ||
        s.tags?.some((t) => t.toLowerCase().includes(needle)),
    ).map((s) => ({
      id: s.id,
      slug: s.id,
      name: s.name,
      source: s.source,
      installs: s.installs,
      sourceType: "github",
      installUrl: s.url ?? `https://skills.sh/${s.source}/${s.id}`,
      url: s.url ?? `https://skills.sh/${s.source}/${s.id}`,
      description: s.description,
    }));
  }

  /**
   * Fetch the leaderboard.
   * Endpoint: GET /api/v1/skills?view={view}&page={page}&per_page={perPage}
   * Response: { data: V1Skill[], pagination: { page, perPage, total, hasMore } }
   */
  async leaderboard(
    view: "all-time" | "trending" | "hot" = "all-time",
    page = 0,
    perPage = 50,
  ): Promise<{ data: SkillsShSearchResult[]; total: number; hasMore: boolean }> {
    try {
      const url = `${this.baseUrl}/skills?view=${view}&page=${page}&per_page=${perPage}`;
      const res = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: SkillsShSearchResult[];
          pagination?: { total?: number; hasMore?: boolean };
        };
        return {
          data: json.data ?? [],
          total: json.pagination?.total ?? 0,
          hasMore: json.pagination?.hasMore ?? false,
        };
      }
    } catch {
      // Offline fallback
    }
    return {
      data: PACKED_SKILLS.map((s) => ({
        id: s.id,
        slug: s.id,
        name: s.name,
        source: s.source,
        installs: s.installs,
        sourceType: "github",
        installUrl: null,
        url: `https://skills.sh/${s.source}/${s.id}`,
        description: s.description,
      })),
      total: PACKED_SKILLS.length,
      hasMore: false,
    };
  }

  /**
   * Fetch the official curated skills.
   * Endpoint: GET /api/v1/skills/curated
   * Response: { data: CuratedOwner[], totalOwners, totalSkills, generatedAt }
   */
  async curated(): Promise<SkillsShSearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/skills/curated`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ owner: string; totalInstalls: number; skills: SkillsShSearchResult[] }>;
        };
        if (Array.isArray(json.data)) {
          return json.data.flatMap((owner) => owner.skills ?? []);
        }
      }
    } catch {
      // Offline fallback
    }
    return [];
  }

  /**
   * Fetch skill details including files / SKILL.md content from skills.sh.
   * Endpoint: GET /api/v1/skills/{id}  where id = "{source}/{slug}"
   *
   * Path format:
   *   GitHub: /api/v1/skills/vercel-labs/skills/find-skills
   *   Well-known: /api/v1/skills/mintlify.com/mintlify
   *
   * Response: { id, source, slug, installs, hash, files: [{ path, contents }] }
   */
  async getSkillDetail(source: string, slug: string): Promise<SkillsShSkillDetail | undefined> {
    try {
      // The id is "{source}/{slug}" — build path as /api/v1/skills/{source}/{slug}
      const url = `${this.baseUrl}/skills/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as SkillsShSkillDetail;
      }
    } catch {
      // Offline fallback
    }

    const local = PACKED_SKILLS.find(
      (s) => s.id === slug || s.source.includes(slug) || s.id === source,
    );
    if (local) {
      return {
        id: local.id,
        source: local.source,
        slug: local.id,
        installs: local.installs,
        files: local.content ? [{ path: "SKILL.md", contents: local.content }] : undefined,
      };
    }
    return undefined;
  }

  /**
   * Parse pack input or install command.
   *
   * Accepted formats:
   *   - "npx skills add https://skills.sh/p/<pack-id>"
   *   - "https://skills.sh/p/<pack-id>"
   *   - "npx skills add <source>"
   *   - "<pack-id>"
   */
  parsePackInput(input: string): { packId: string; isUrl: boolean } | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    // Match npx skills add https://skills.sh/p/<pack-id>
    const npxMatch = /npx\s+skills\s+add\s+https?:\/\/skills\.sh\/p\/([a-zA-Z0-9_-]+)/i.exec(trimmed);
    if (npxMatch?.[1]) {
      return { packId: npxMatch[1], isUrl: true };
    }

    // Match https://skills.sh/p/<pack-id>
    const urlMatch = /https?:\/\/skills\.sh\/p\/([a-zA-Z0-9_-]+)/i.exec(trimmed);
    if (urlMatch?.[1]) {
      return { packId: urlMatch[1], isUrl: true };
    }

    // Match npx skills add <source>
    const addMatch = /npx\s+skills\s+add\s+([a-zA-Z0-9_./-]+)/i.exec(trimmed);
    if (addMatch?.[1]) {
      return { packId: addMatch[1], isUrl: false };
    }

    return { packId: trimmed, isUrl: false };
  }

  /**
   * Create a Skill model from a SkillsShSearchResult.
   * installUrl can be used with: npx skills add {installUrl}
   */
  createSkillFromSearch(result: SkillsShSearchResult, content?: string): Skill {
    return {
      id: result.slug || result.id,
      name: result.name || result.slug,
      version: "1.0.0",
      description: result.description || `Community skill from ${result.source}`,
      source: result.source,
      status: "installed",
      requirements: [],
      permissions: { filesystem: "approval" },
      validation: "passed",
      installs: result.installs,
      url: result.url,
      content: content ?? `# ${result.name}\n\nInstalled from ${result.source}`,
      tags: ["skills.sh"],
    };
  }
}

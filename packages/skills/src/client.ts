import type { SkillsShSearchResult } from "@capsule/shared";

/**
 * Client for the skills.sh API (https://skills.sh/docs/api): the leaderboard
 * (GET /api/v1/skills) and search (GET /api/v1/skills/search).
 *
 * Authentication is not optional: every endpoint answers 401 without a Vercel
 * OIDC token, which is minted per request for code running inside a Vercel
 * deployment. A desktop app cannot obtain one, so these calls only succeed
 * when the person supplies a token. The directory reads GitHub otherwise; see
 * `SkillCatalogClient` in ./github.ts.
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
   * Search skills.sh. This reports failure:
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
}

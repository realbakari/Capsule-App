import { describe, expect, it, vi } from "vitest";
import { SkillCatalogClient, parseSkillDoc, type SkillRepoRef } from "./github.js";

/** Minimal fetch double keyed by URL substring. */
function stubFetch(routes: Array<[string, { ok?: boolean; status?: number; body: unknown }]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const hit = routes.find(([fragment]) => url.includes(fragment));
    if (!hit) return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
    const [, spec] = hit;
    return {
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      json: async () => spec.body,
      text: async () => String(spec.body),
    } as Response;
  }) as unknown as typeof fetch;
}

const ONE_REPO: SkillRepoRef[] = [{ owner: "acme", repo: "skills", dir: "skills" }];

describe("parseSkillDoc", () => {
  it("reads description from frontmatter", () => {
    expect(parseSkillDoc("---\nname: pdf\ndescription: Work with PDFs.\n---\n\n# PDF").description).toBe(
      "Work with PDFs.",
    );
  });

  it("joins a wrapped description that continues on indented lines", () => {
    const doc = "---\nname: x\ndescription: First part\n  second part\nlicense: MIT\n---\n";
    expect(parseSkillDoc(doc).description).toBe("First part second part");
  });

  it("strips surrounding quotes", () => {
    expect(parseSkillDoc('---\ndescription: "Quoted."\n---\n').description).toBe("Quoted.");
  });

  it("drops YAML block-scalar indicators", () => {
    expect(parseSkillDoc("---\ndescription: |-\n  Reference for the API.\n---\n").description).toBe(
      "Reference for the API.",
    );
    expect(parseSkillDoc("---\ndescription: >\n  Stop and check this.\n---\n").description).toBe(
      "Stop and check this.",
    );
    expect(parseSkillDoc("---\ndescription: >-\n  Folded.\n---\n").description).toBe("Folded.");
  });

  it("keeps a description that merely starts with a greater-than word", () => {
    expect(parseSkillDoc("---\ndescription: >5 means more than five\n---\n").description).toBe(
      "means more than five",
    );
  });

  it("returns nothing when there is no frontmatter", () => {
    expect(parseSkillDoc("# Just a heading").description).toBeUndefined();
  });
});

describe("SkillCatalogClient", () => {
  it("builds entries from a live listing and SKILL.md", async () => {
    const fetchImpl = stubFetch([
      [
        "/contents/skills",
        {
          body: [
            { name: "pdf", path: "skills/pdf", type: "dir", html_url: "https://github.com/acme/skills/tree/main/skills/pdf" },
            { name: "README.md", path: "skills/README.md", type: "file", html_url: null },
          ],
        },
      ],
      ["raw.githubusercontent.com", { body: "---\ndescription: Work with PDFs.\n---\n" }],
    ]);
    const client = new SkillCatalogClient(ONE_REPO, fetchImpl);
    const page = await client.catalog();

    expect(page.errors).toEqual([]);
    expect(page.entries).toHaveLength(1); // the file is not a skill
    expect(page.entries[0]).toMatchObject({
      id: "acme/skills/pdf",
      name: "pdf",
      source: "acme/skills",
      description: "Work with PDFs.",
      ref: "main", // read out of html_url, not a second API call
      origin: "github",
    });
  });

  it("leaves description undefined when SKILL.md is missing rather than inventing one", async () => {
    const fetchImpl = stubFetch([
      ["/contents/skills", { body: [{ name: "solo", path: "skills/solo", type: "dir", html_url: null }] }],
      ["raw.githubusercontent.com", { ok: false, status: 404, body: "" }],
    ]);
    const page = await new SkillCatalogClient(ONE_REPO, fetchImpl).catalog();
    expect(page.entries[0]?.description).toBeUndefined();
    expect(page.entries[0]?.stars).toBeUndefined();
    expect(page.entries[0]?.ref).toBe("main"); // falls back when html_url is null
  });

  it("reports a failed source instead of silently returning a short catalog", async () => {
    const fetchImpl = stubFetch([["api.github.com", { ok: false, status: 403, body: {} }]]);
    const page = await new SkillCatalogClient(ONE_REPO, fetchImpl).catalog();
    expect(page.entries).toEqual([]);
    expect(page.errors[0]).toContain("rate limit");
  });

  it("keeps one source's failure from hiding another's results", async () => {
    const repos: SkillRepoRef[] = [
      { owner: "good", repo: "skills", dir: "skills" },
      { owner: "bad", repo: "skills", dir: "skills" },
    ];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/bad/")) return { ok: false, status: 500, json: async () => ({}), text: async () => "" } as Response;
      if (url.includes("/contents/skills")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "ok-skill", path: "skills/ok-skill", type: "dir", html_url: null }],
          text: async () => "",
        } as Response;
      }
      if (url.includes("raw.githubusercontent.com")) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "---\ndescription: Fine.\n---\n" } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }), text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const page = await new SkillCatalogClient(repos, fetchImpl).catalog();
    expect(page.entries.map((e) => e.name)).toEqual(["ok-skill"]);
    expect(page.errors).toHaveLength(1);
    expect(page.errors[0]).toContain("bad/skills");
  });

  it("filters the fetched catalog without refetching", async () => {
    const fetchImpl = stubFetch([
      [
        "/contents/skills",
        {
          body: [
            { name: "pdf", path: "skills/pdf", type: "dir", html_url: null },
            { name: "docx", path: "skills/docx", type: "dir", html_url: null },
          ],
        },
      ],
      ["raw.githubusercontent.com", { body: "---\ndescription: Office files.\n---\n" }],
    ]);
    const client = new SkillCatalogClient(ONE_REPO, fetchImpl);
    await client.catalog();
    const callsAfterFirstLoad = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    expect((await client.search("pdf")).entries.map((e) => e.name)).toEqual(["pdf"]);
    expect((await client.search("")).entries).toHaveLength(2);
    // A description match counts, not just the name.
    expect((await client.search("office")).entries).toHaveLength(2);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirstLoad);
  });

  it("does not cache an empty page, so a failed load retries", async () => {
    let fail = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (fail) return { ok: false, status: 500, json: async () => ({}), text: async () => "" } as Response;
      if (url.includes("/contents/skills")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "later", path: "skills/later", type: "dir", html_url: null }],
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }), text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const client = new SkillCatalogClient(ONE_REPO, fetchImpl);
    expect((await client.catalog()).entries).toEqual([]);
    fail = false;
    expect((await client.catalog()).entries.map((e) => e.name)).toEqual(["later"]);
  });
});

describe("SkillsShClient token handling", () => {
  it("refuses to call without a token instead of returning a silent fallback", async () => {
    const { SkillsShClient } = await import("./client.js");
    const client = new SkillsShClient({ token: undefined });
    client.setToken(undefined);
    expect(client.hasToken()).toBe(false);
    await expect(client.searchStrict("react")).rejects.toThrow("No skills.sh token");
  });

  it("explains a 401 rather than reporting an empty catalog", async () => {
    const { SkillsShClient } = await import("./client.js");
    const client = new SkillsShClient({ token: "t" });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    try {
      await expect(client.searchStrict("react")).rejects.toThrow(/401.*Vercel OIDC/s);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("request budget", () => {
  it("spends one GitHub API call per repo — the hourly budget is only 60", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/contents/skills")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              name: "pdf",
              path: "skills/pdf",
              type: "dir",
              html_url: "https://github.com/acme/skills/tree/trunk/skills/pdf",
            },
          ],
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const page = await new SkillCatalogClient(ONE_REPO, fetchImpl).catalog();
    const apiCalls = calls.filter((url) => url.includes("api.github.com"));
    expect(apiCalls).toHaveLength(1);
    // The branch comes from html_url, so no metadata call is needed for it.
    expect(page.entries[0]?.ref).toBe("trunk");
    expect(calls.some((url) => url.includes("raw.githubusercontent.com/acme/skills/trunk/"))).toBe(true);
  });

  it("serves the last good catalog when a refetch fails, instead of emptying the view", async () => {
    let healthy = true;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (!healthy) return { ok: false, status: 403, json: async () => ({}), text: async () => "" } as Response;
      if (url.includes("/contents/skills")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "pdf", path: "skills/pdf", type: "dir", html_url: null }],
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const client = new SkillCatalogClient(ONE_REPO, fetchImpl);
    expect((await client.catalog()).entries).toHaveLength(1);

    healthy = false;
    const stale = await client.catalog(true);
    expect(stale.entries).toHaveLength(1);
    expect(stale.errors.join(" ")).toContain("rate limit");
  });

  it("restores a persisted catalog so a restart does not spend the budget", async () => {
    const saved: { page?: unknown } = {};
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/contents/skills")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "pdf", path: "skills/pdf", type: "dir", html_url: null }],
          text: async () => "",
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    const store = {
      read: () => saved.page as never,
      write: (page: unknown) => {
        saved.page = page;
      },
    };

    await new SkillCatalogClient(ONE_REPO, fetchImpl, undefined, store).catalog();
    expect(saved.page).toBeDefined();

    // A fresh client with a dead network still has the catalog.
    const dead = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const restarted = new SkillCatalogClient(ONE_REPO, dead, undefined, store);
    expect((await restarted.catalog()).entries).toHaveLength(1);
  });
});

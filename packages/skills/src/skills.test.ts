import { describe, expect, it } from "vitest";
import { DEFAULT_SKILLS, DEFAULT_SKILL_PACKS, SkillsShClient } from "./index.js";

describe("@capsule/skills", () => {
  it("exports packed skills and default skill packs", () => {
    expect(DEFAULT_SKILLS.length).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_SKILL_PACKS.length).toBe(5);

    const nextjs = DEFAULT_SKILLS.find((s) => s.id === "nextjs");
    expect(nextjs).toBeDefined();
    expect(nextjs?.packId).toBe("web-react-pack");
    expect(nextjs?.content).toContain("Next.js 15");

    const supabase = DEFAULT_SKILLS.find((s) => s.id === "supabase");
    expect(supabase).toBeDefined();
    expect(supabase?.packId).toBe("backend-db-pack");
  });

  it("SkillsShClient parses pack inputs and commands", () => {
    const client = new SkillsShClient();

    const p1 = client.parsePackInput("https://skills.sh/p/web-react");
    expect(p1).toEqual({ packId: "web-react", isUrl: true });

    const p2 = client.parsePackInput("npx skills add https://skills.sh/p/backend-db");
    expect(p2).toEqual({ packId: "backend-db", isUrl: true });

    const p3 = client.parsePackInput("npx skills add vercel-labs/nextjs");
    expect(p3).toEqual({ packId: "vercel-labs/nextjs", isUrl: false });
  });

  it("SkillsShClient fallback search returns matching packed skills", async () => {
    const client = new SkillsShClient();
    const results = await client.search("react");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === "react" || r.id === "nextjs")).toBe(true);
  });
});

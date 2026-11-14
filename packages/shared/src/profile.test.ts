import { describe, expect, it } from "vitest";
import { parseProfileFile, summarizeProfile } from "./profile.js";

describe("parseProfileFile", () => {
  it("reads every field and keeps the body as first-turn instructions", () => {
    const { profile, problems } = parseProfileFile("reviewer", [
      "---",
      "name: Reviewer",
      "description: Reads before it writes",
      "harness: codex",
      "model: gpt-5.5",
      "effort: high",
      "permission: strict",
      "mode: plan",
      "workspace: worktree",
      "skills: [review, security]",
      "style: concise",
      "mcp:",
      "  - postgres",
      "color: \"#4A7A5C\"",
      "---",
      "Lead with risks.",
    ].join("\n"));
    expect(problems).toEqual([]);
    expect(profile).toEqual({
      id: "reviewer", name: "Reviewer", description: "Reads before it writes", agent: "codex", model: "gpt-5.5", effort: "high",
      permission: "strict", mode: "plan", workspace: "worktree", skills: ["review", "security"], style: "concise", mcp: ["postgres"],
      color: "#4A7A5C", instructions: "Lead with risks.",
    });
  });

  it("skips a wrong value on its own and names the line", () => {
    const { profile, problems } = parseProfileFile("fast", "---\npermission: yolo\nmode: code\ncolor: green\nbogus: 1\n---\n");
    expect(profile?.mode).toBe("code");
    expect(profile?.permission).toBeUndefined();
    expect(profile?.color).toBeUndefined();
    expect(problems).toEqual([
      "line 2: permission must be one of default, strict, approve-all.",
      "line 4: color must be a colour like #4A7A5C.",
      'line 5: unknown key "bogus" is ignored.',
    ]);
  });

  it("refuses a name that cannot be bound or typed", () => {
    expect(parseProfileFile("Bad Name", "").profile).toBeUndefined();
  });

  it("leaves mcp absent so every enabled server is offered, and an empty list offers none", () => {
    expect(parseProfileFile("a", "---\nname: A\n---\n").profile?.mcp).toBeUndefined();
    expect(parseProfileFile("b", "---\nmcp: []\n---\n").profile?.mcp).toEqual([]);
  });

  it("summarizes without the body", () => {
    const { profile } = parseProfileFile("a", "---\nname: A\n---\nDo it.");
    expect(summarizeProfile(profile!, { scope: "user", path: "/p/a.md" })).toEqual({ id: "a", name: "A", skills: [], scope: "user", path: "/p/a.md", hasInstructions: true });
  });
});

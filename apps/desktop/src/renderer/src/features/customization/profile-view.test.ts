import { describe, expect, it } from "vitest";
import type { ProfileSummary } from "@capsule/shared";
import { mcpStatusText, profileLine } from "./profile-view";

const base: ProfileSummary = { id: "r", name: "Reviewer", skills: [], scope: "user", path: "/p/r.md", hasInstructions: false };

describe("profile view", () => {
  it("says what a profile starts in one line", () => {
    expect(profileLine({ ...base, agent: "codex", model: "gpt-5.5", effort: "high", permission: "strict", workspace: "worktree" }, [{ id: "codex", name: "Codex" }]))
      .toBe("Codex · gpt-5.5 · high effort · Supervised · worktree");
    expect(profileLine(base, [])).toBe("Your default agent");
  });

  it("names a server's state in words", () => {
    expect(mcpStatusText({ state: "needs-env", missing: ["TOKEN"] })).toBe("Waiting for ${env:TOKEN}");
    expect(mcpStatusText({ state: "offered" })).toBe("Offered to direct conversations");
  });
});

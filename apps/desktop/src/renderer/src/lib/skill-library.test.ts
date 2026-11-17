import { expect, it } from "vitest";
import type { Skill } from "@capsule/shared";
import { skillLibraryRows } from "./skill-library";

const skill = (id: string, name: string, extra: Partial<Skill> = {}): Skill => ({
  id, name, description: `${name} guidance`, source: "owner/repo", status: "installed", requirements: [], permissions: {}, ...extra,
});

it("lists installed skills once, by name, naming the source only where two share a name", () => {
  const rows = skillLibraryRows([
    skill("global:codex:lint", "lint", { source: "Codex", managedExternally: true, tags: ["global", "codex"] }),
    skill("owner/repo/zeta", "zeta"),
    skill("global:claude:lint", "Lint", { source: "Claude Code", managedExternally: true, tags: ["global", "claude"] }),
    skill("owner/repo/alpha", "alpha"),
    skill("owner/repo/gone", "beta", { status: "available" }),
  ], "");
  expect(rows.map((row) => [row.skill.name, row.source])).toEqual([
    ["alpha", undefined],
    ["lint", "Codex"],
    ["Lint", "Claude Code"],
    ["zeta", undefined],
  ]);
});

it("puts the best name match first when searching", () => {
  const rows = skillLibraryRows([
    skill("owner/repo/docs", "docs-writer", { description: "Uses review notes" }),
    skill("owner/repo/review", "review"),
    skill("owner/repo/pr", "pr-review"),
  ], "review");
  expect(rows.map((row) => row.skill.name)).toEqual(["review", "pr-review", "docs-writer"]);
});

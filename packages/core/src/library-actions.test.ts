import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { Skill } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it("rejects empty skills and oversized action edits without changing stored data", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-library-actions-"));
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, autoConnect: false });
  await engine.start();
  try {
    const skill: Skill = { id: "regression-skill", name: "Test skill", description: "Instructions", source: "test", status: "available", requirements: [], permissions: {} };
    expect(() => engine.installSkill({ ...skill, content: "  " })).toThrow("SKILL.md");
    expect((await engine.listSkills()).find((item) => item.id === skill.id)).toBeUndefined();
    engine.installSkill({ ...skill, content: "# Keep the instructions" });
    expect((await engine.listSkills()).find((item) => item.id === skill.id)?.version).toBeUndefined();
    expect(() => engine.installSkill(skill)).toThrow("SKILL.md");
    expect((await engine.listSkills()).find((item) => item.id === skill.id)?.content).toBe("# Keep the instructions");

    const project = engine.createProject({ name: "Action regression" });
    const original = [{ id: "test", name: "Tests", command: "node --test" }];
    engine.updateProject(project.id, { actions: original });
    expect(() => engine.updateProject(project.id, { actions: [{ ...original[0]!, command: "x".repeat(2001) }] })).toThrow("2,000");
    expect(engine.getProject(project.id)?.actions).toEqual(original);
    expect(() => engine.updateProject(project.id, { actions: Array.from({ length: 25 }, (_, index) => ({ ...original[0]!, id: `a-${index}` })) })).toThrow("24 actions");
    expect(engine.getProject(project.id)?.actions).toEqual(original);
  } finally { await engine.stop(); }
});

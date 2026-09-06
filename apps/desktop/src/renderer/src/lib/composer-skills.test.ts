import { expect, it } from "vitest";
import type { Skill } from "@capsule/shared";
import { searchComposerSkills, skillSource } from "./composer-skills";
const skill = { id: "one", name: "review-code", description: "Check a change", status: "installed", source: "Local", requirements: [], permissions: {} } as Skill;
it("ranks skill names, searches across words, hides unavailable skills, and keeps source identity", () => {
  const items = [skill, { ...skill, id: "two", source: "Project", tags: ["project-claude"] }, { ...skill, id: "off", status: "disabled" as const }];
  expect(searchComposerSkills(items, "review code").map((item) => item.id)).toEqual(["one", "two"]);
  expect(searchComposerSkills(items, "change")).toHaveLength(2);
  expect(skillSource(items[1]!)).toBe("Project");
});

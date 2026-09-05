import { expect, it, vi } from "vitest";
import type { Skill, SkillCatalogEntry } from "@capsule/shared";
import { installedCatalogSkill, installSkillWithContent } from "./skill-install";

const skill: Skill = { id: "owner/repo/skill", name: "Review", source: "owner/repo", status: "available", description: "Review changes", requirements: [], permissions: {}, validation: "unvalidated" };

it("fetches and persists instructions before the install promise resolves", async () => {
  let finish!: (skill: Skill) => void;
  const installSkill = vi.fn(() => new Promise<Skill>((resolve) => { finish = resolve; }));
  const completed = vi.fn();
  const pending = installSkillWithContent(skill, { fetchSkillDetail: async () => "# Instructions", installSkill }).then(completed);
  await vi.waitFor(() => expect(installSkill).toHaveBeenCalled());
  expect(installSkill).toHaveBeenCalledWith({ ...skill, content: "# Instructions" });
  expect(completed).not.toHaveBeenCalled();
  finish({ ...skill, status: "installed", content: "# Instructions" });
  await pending;
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: "installed" }));
});

it("never stores an empty document or claims a rejected install succeeded", async () => {
  const installSkill = vi.fn(async () => { throw new Error("Storage unavailable"); });
  await expect(installSkillWithContent(skill, { fetchSkillDetail: async () => "  ", installSkill })).rejects.toThrow("Nothing was installed");
  expect(installSkill).not.toHaveBeenCalled();
  await expect(installSkillWithContent(skill, { fetchSkillDetail: async () => "# Instructions", installSkill })).rejects.toThrow("Storage unavailable");
});

it("uses the inspected document without fetching a different copy at install time", async () => {
  const fetchSkillDetail = vi.fn();
  const installSkill = vi.fn(async (value: Skill) => ({ ...value, status: "installed" as const }));
  await installSkillWithContent({ ...skill, content: "# Inspected" }, { fetchSkillDetail, installSkill });
  expect(fetchSkillDetail).not.toHaveBeenCalled();
  expect(installSkill).toHaveBeenCalledWith(expect.objectContaining({ content: "# Inspected" }));
});

it("does not match unrelated skills by name and returns the actual installed record", () => {
  const entry = { id: skill.id, name: skill.name, url: "https://github.com/owner/repo/tree/main/skill" } as SkillCatalogEntry;
  const unrelated = { ...skill, id: "global:other:review", status: "installed" as const };
  expect(installedCatalogSkill(entry, [unrelated])).toBeUndefined();
  const actual = { ...unrelated, url: `${entry.url}/`, managedExternally: true };
  expect(installedCatalogSkill(entry, [actual])).toBe(actual);
});

import type { Skill } from "@capsule/shared";
import { rankMatches } from "./composer-rank";
import { skillSource } from "./composer-skills";

export interface SkillLibraryRow {
  skill: Skill;
  /** Where the skill was found, shown only when another installed skill has the same name. */
  source?: string;
}

/**
 * The Installed list: every installed skill in one list, best match first
 * when searching and by name otherwise. A source label is noise on a row
 * whose name is unique, and the only way to tell two equally named skills
 * apart when it is not.
 */
export function skillLibraryRows(skills: readonly Skill[], query: string): SkillLibraryRow[] {
  const installed = skills.filter((skill) => skill.status === "installed").sort((a, b) => a.name.localeCompare(b.name));
  const named = new Map<string, number>();
  for (const skill of installed) named.set(skill.name.toLowerCase(), (named.get(skill.name.toLowerCase()) ?? 0) + 1);
  return rankMatches(installed, query, (skill) => skill.name, (skill) => `${skill.description} ${skillSource(skill)}`)
    .map((skill) => (named.get(skill.name.toLowerCase())! > 1 ? { skill, source: skillSource(skill) } : { skill }));
}

import type { Skill } from "@capsule/shared";
import { rankMatches } from "./composer-rank";

export function skillSource(skill: Skill): string {
  if (skill.tags?.some((tag) => tag.startsWith("project-"))) return "Project";
  if (skill.managedExternally) return skill.source || "Personal";
  return skill.packName || skill.source || "Workspace";
}

/** Keep source identity: equally named skills need not contain equal instructions. */
export function searchComposerSkills(skills: Skill[], query: string): Skill[] {
  const installed = skills.filter((skill) => skill.status === "installed").sort((a, b) => a.name.localeCompare(b.name));
  return rankMatches(installed, query, (skill) => skill.name, (skill) => `${skill.description} ${skillSource(skill)}`).slice(0, 40);
}

import type { Skill } from "@capsule/shared";

export function skillSource(skill: Skill): string {
  if (skill.tags?.some((tag) => tag.startsWith("project-"))) return "Project";
  if (skill.managedExternally) return skill.source || "Personal";
  return skill.packName || skill.source || "Workspace";
}

/** Keep source identity: equally named skills need not contain equal instructions. */
export function searchComposerSkills(skills: Skill[], query: string): Skill[] {
  const terms = query.toLowerCase().replace(/[-_]/g, " ").trim().split(/\s+/).filter(Boolean);
  return skills.filter((skill) => skill.status === "installed").map((skill) => {
    const name = skill.name.toLowerCase().replace(/[-_]/g, " ");
    const haystack = `${name} ${skill.description} ${skillSource(skill)}`.toLowerCase();
    return { skill, match: terms.every((term) => haystack.includes(term)), score: terms.every((term) => name.includes(term)) ? 0 : 1 };
  }).filter((item) => item.match).sort((a, b) => a.score - b.score || a.skill.name.localeCompare(b.skill.name)).slice(0, 40).map((item) => item.skill);
}

import type { Skill, SkillCatalogEntry } from "@capsule/shared";

/** Names are not identities: different repositories can publish the same name. */
export function installedCatalogSkill(entry: SkillCatalogEntry, skills: readonly Skill[]): Skill | undefined {
  const url = entry.url?.replace(/\/+$/, "");
  return skills.find((skill) => skill.status === "installed" && (
    skill.id === entry.id || Boolean(url && skill.url?.replace(/\/+$/, "") === url)
  ));
}

/** All install controls must persist the document before allowing attachment. */
export async function installSkillWithContent(skill: Skill, api: {
  fetchSkillDetail: (id: string) => Promise<string | undefined>;
  installSkill: (skill: Skill) => Promise<Skill>;
}): Promise<Skill> {
  const content = skill.content?.trim() ? skill.content : await api.fetchSkillDetail(skill.id);
  if (!content?.trim()) throw new Error(`Could not read SKILL.md for ${skill.name}. Nothing was installed.`);
  return api.installSkill({ ...skill, content });
}

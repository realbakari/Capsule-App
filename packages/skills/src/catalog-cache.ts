import type { SkillCatalogEntry, SkillCatalogPage } from "@capsule/shared";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entry(value: unknown): value is SkillCatalogEntry {
  if (!record(value)) return false;
  return ["id", "name", "source", "url"].every((key) =>
    typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 8192,
  ) && ["description", "docPath", "ref"].every((key) =>
    value[key] === undefined || (typeof value[key] === "string" && value[key].length <= 65536),
  ) && ["stars", "installs"].every((key) =>
    value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0),
  ) && (value.origin === undefined || value.origin === "github" || value.origin === "skills.sh");
}

export function readCatalogCache(value: unknown): SkillCatalogPage | undefined {
  if (!record(value) || !Array.isArray(value.entries) || value.entries.length > 10000 ||
    !value.entries.every(entry) || !Array.isArray(value.errors) || value.errors.length > 1000 ||
    !value.errors.every((error: unknown) => typeof error === "string" && error.length <= 65536) ||
    typeof value.fetchedAt !== "number" || !Number.isFinite(value.fetchedAt) || value.fetchedAt < 0 ||
    (value.skillsShConnected !== undefined && typeof value.skillsShConnected !== "boolean")) return undefined;
  return {
    entries: value.entries,
    errors: value.errors,
    fetchedAt: value.fetchedAt,
    ...(typeof value.skillsShConnected === "boolean" ? { skillsShConnected: value.skillsShConnected } : {}),
  };
}

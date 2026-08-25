import { createId, nowIso, type CreateProjectInput, type Project } from "@capsule/shared";

export function createProjectRecord(
  workspaceId: string,
  input: CreateProjectInput,
): Project {
  const timestamp = nowIso();
  return {
    id: createId("proj"),
    workspaceId,
    name: input.name.trim() || "Untitled project",
    description: input.description,
    workingDirectory: input.workingDirectory,
    defaultAgentId: input.defaultAgentId,
    defaultSkillIds: [],
    defaultMode: input.defaultMode ?? "chat",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

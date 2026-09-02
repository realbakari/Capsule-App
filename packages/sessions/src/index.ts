import {
  createId,
  nowIso,
  type CreateSessionInput,
  type Project,
  type Session,
} from "@capsule/shared";

export function createSessionRecord(
  project: Project,
  input: CreateSessionInput,
  agentId: string,
): Session {
  const timestamp = nowIso();
  return {
    id: createId("sess"),
    workspaceId: project.workspaceId,
    projectId: project.id,
    agentId,
    title: input.title?.trim() || "New conversation",
    mode: input.mode ?? project.defaultMode,
    state: "active",
    permissionProfile: input.permissionProfile,
    workingDirectory: input.workingDirectory,
    workspaceMode: input.workspaceMode ?? "local",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}…` : cleaned;
}

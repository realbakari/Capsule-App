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
  // A title is a local first-line preview, not another agent turn. Bound the
  // work even when the prompt is a long pasted log, and keep words intact.
  const firstLine = prompt.slice(0, 4096).trim().split(/\r?\n/u)[0] ?? "";
  const cleaned = firstLine
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`|\*\*/gu, "")
    .replace(/\s+/gu, " ").trim();
  if (!cleaned) return "New conversation";
  const characters = Array.from(cleaned);
  if (characters.length <= 72) return cleaned;
  const prefix = characters.slice(0, 71).join("");
  const wordEnd = prefix.lastIndexOf(" ");
  return `${wordEnd >= 40 ? prefix.slice(0, wordEnd) : prefix}…`;
}

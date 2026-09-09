import type { Project, Session } from "@capsule/shared";

/** Navigation hints are not proof that a project or thread still exists. */
export function resolveWorkspaceSelection(
  projects: readonly Pick<Project, "id">[],
  sessions: readonly Pick<Session, "id" | "projectId" | "state">[],
  projectId?: string,
  sessionId?: string,
): { projectId?: string; sessionId?: string } {
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  if (!project) return {};

  // Keep explicitly opened archived history, but never choose it as a fallback.
  const session = sessions.find((item) => item.id === sessionId && item.projectId === project.id)
    ?? sessions.find((item) => item.projectId === project.id && item.state === "active");
  return { projectId: project.id, sessionId: session?.id };
}

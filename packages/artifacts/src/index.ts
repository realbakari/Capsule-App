import { createId, nowIso, type Artifact, type Run, type Session } from "@capsule/shared";

export function createTextArtifact(input: {
  session: Session;
  run: Run;
  title: string;
  content: string;
  kind?: Artifact["kind"];
}): Artifact {
  return {
    id: createId("art"),
    workspaceId: input.session.workspaceId,
    projectId: input.session.projectId,
    sessionId: input.session.id,
    runId: input.run.id,
    agentId: input.run.agentId,
    kind: input.kind ?? "report",
    title: input.title,
    mimeType: "text/markdown",
    content: input.content,
    createdAt: nowIso(),
  };
}

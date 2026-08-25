import {
  createId,
  nowIso,
  type ProgressStep,
  type Run,
  type RunEvent,
} from "@capsule/shared";

export function createRunRecord(input: {
  sessionId: string;
  projectId: string;
  agentId: string;
  skillId?: string;
  prompt: string;
}): Run {
  const timestamp = nowIso();
  return {
    id: createId("run"),
    sessionId: input.sessionId,
    projectId: input.projectId,
    agentId: input.agentId,
    skillId: input.skillId,
    status: "queued",
    prompt: input.prompt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createRunEvent(
  runId: string,
  type: string,
  message: string,
  data?: Record<string, unknown>,
): RunEvent {
  return {
    id: createId("evt"),
    runId,
    timestamp: nowIso(),
    type,
    message,
    data,
  };
}

export const DEFAULT_PROGRESS: ProgressStep[] = [
  { id: "understand", label: "Understanding request", status: "pending" },
  { id: "route", label: "Selecting agent", status: "pending" },
  { id: "skill", label: "Loading skill", status: "pending" },
  { id: "tools", label: "Running tools", status: "pending" },
  { id: "verify", label: "Verifying result", status: "pending" },
];

export function applyProgress(
  steps: ProgressStep[],
  activeId: string,
): ProgressStep[] {
  const index = steps.findIndex((step) => step.id === activeId);
  return steps.map((step, i) => {
    if (i < index) return { ...step, status: "complete" };
    if (i === index) return { ...step, status: "active" };
    return { ...step, status: "pending" };
  });
}

export function completeProgress(steps: ProgressStep[]): ProgressStep[] {
  return steps.map((step) => ({ ...step, status: "complete" as const }));
}

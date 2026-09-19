import { sanitizeUntrusted } from "./untrusted.js";
import type { RunEvent } from "./types.js";

export type RunTaskStatus = "pending" | "inProgress" | "completed";

export interface RunTask {
  id: string;
  content: string;
  status: RunTaskStatus;
}

const MAX_TASKS = 32;
const MAX_CONTENT = 200;

function normalizeStatus(value: unknown): RunTaskStatus {
  const status = String(value ?? "").toLowerCase().replace(/-/g, "_");
  if (status === "completed" || status === "complete" || status === "done") return "completed";
  if (status === "in_progress" || status === "inprogress" || status === "running" || status === "active") {
    return "inProgress";
  }
  return "pending";
}

function isTodoTitle(value: string | undefined): boolean {
  const title = (value ?? "").toLowerCase();
  return title.includes("todo") || /\bplan\b/.test(title);
}

/** One replacement snapshot. An empty list clears the plan; malformed input is ignored. */
export function readPlanEntries(value: unknown): RunTask[] | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const list = Array.isArray(value)
    ? value
    : Array.isArray(record?.entries)
      ? record.entries
      : Array.isArray(record?.todos)
        ? record.todos
        : Array.isArray(record?.plan)
          ? record.plan
          : undefined;
  if (!list) return undefined;
  if (list.length === 0) return [];
  const tasks: RunTask[] = [];
  for (const [index, item] of list.slice(0, MAX_TASKS).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const content = typeof row.content === "string"
      ? sanitizeUntrusted(row.content, { singleLine: true, maxChars: MAX_CONTENT })
      : typeof row.text === "string"
        ? sanitizeUntrusted(row.text, { singleLine: true, maxChars: MAX_CONTENT })
        : "";
    if (!content) continue;
    const id = typeof row.id === "string" && row.id.length > 0 && row.id.length <= 64
      ? sanitizeUntrusted(row.id, { singleLine: true, maxChars: 64 })
      : String(index);
    tasks.push({ id, content, status: normalizeStatus(row.status) });
  }
  return tasks.length > 0 ? tasks : undefined;
}

function planFromEventData(data: Record<string, unknown> | undefined): RunTask[] | undefined {
  if (!data) return undefined;
  const nested = data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : undefined;
  const update = data.update && typeof data.update === "object" && !Array.isArray(data.update)
    ? data.update as Record<string, unknown>
    : undefined;
  return readPlanEntries(data)
    ?? readPlanEntries(data.plan)
    ?? readPlanEntries(nested)
    ?? readPlanEntries(update)
    ?? readPlanEntries(data.rawInput)
    ?? readPlanEntries(nested?.rawInput)
    ?? readPlanEntries(data.rawOutput);
}

/**
 * The latest plan the agent reported on this run.
 *
 * ACP `plan` updates replace the whole list. A todo-writing tool does the same
 * when its payload carries entries. Older snapshots stay in the event log.
 */
export function tasksFromRunEvents(events: readonly RunEvent[]): RunTask[] {
  let latest: RunTask[] | undefined;
  for (const event of events) {
    const kind = String(event.data?.streamKind ?? event.type).toLowerCase();
    const title = event.message || (typeof event.data?.title === "string" ? event.data.title : undefined);
    const fromPlan = kind === "plan" ? planFromEventData(event.data) : undefined;
    const fromTool = (kind === "tool" || kind.startsWith("tool")) && isTodoTitle(title)
      ? planFromEventData(event.data)
      : undefined;
    const next = fromPlan ?? fromTool;
    if (next) latest = next;
  }
  return latest ?? [];
}

export function taskProgress(tasks: readonly RunTask[]): {
  step: string;
  completedSteps: number;
  totalSteps: number;
} {
  const completedSteps = tasks.filter((task) => task.status === "completed").length;
  const current = tasks.find((task) => task.status === "inProgress") ?? tasks.find((task) => task.status === "pending");
  return {
    step: current?.content ?? (completedSteps === tasks.length ? "All tasks complete" : "Tasks"),
    completedSteps,
    totalSteps: tasks.length,
  };
}

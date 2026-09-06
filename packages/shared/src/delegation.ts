import type { Run, RunEvent } from "./types.js";
import { sanitizeUntrusted } from "./untrusted.js";

export interface DelegationDetails { role?: string; title?: string; model?: string; totalTokens?: number; background?: boolean }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const label = (value: unknown) => typeof value === "string" ? sanitizeUntrusted(value, { maxChars: 160, singleLine: true }).trim() || undefined : undefined;

/** Only structured delegation inputs count. Tool titles and assistant prose are not evidence. */
export function readDelegationDetails(tool: unknown): DelegationDetails | undefined {
  const data = record(tool);
  const input = record(data.rawInput);
  const output = record(data.rawOutput);
  const role = label(input.subagent_type);
  const usage = record(output.usage);
  const tokens = usage.total_tokens;
  const totalTokens = typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : undefined;
  if (!role && totalTokens === undefined) return undefined;
  const title = label(input.description);
  const model = label(input.model);
  return {
    ...(role ? { role, ...(title ? { title } : {}), ...(model ? { model } : {}), ...(typeof input.run_in_background === "boolean" ? { background: input.run_in_background } : {}) } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

export interface DelegatedTask extends DelegationDetails {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "unknown";
  activity?: string;
}

/** Stable tool-call order, bounded by the caller's event window. Never infer a child's lifetime from its parent. */
export function delegatedTasks(run: Run, events: RunEvent[]): DelegatedTask[] {
  const tasks = new Map<string, DelegatedTask>();
  for (const event of events) {
    if (event.runId !== run.id || (event.sessionId && event.sessionId !== run.sessionId) || event.type !== "tool") continue;
    // Direct events carry fields directly; Gateway runtime frames nest them in data.
    const outer = record(event.data);
    const tool = outer.delegationTool ? record(outer.delegationTool) : typeof outer.toolCallId === "string" ? outer : record(outer.data);
    const id = typeof tool.toolCallId === "string" && tool.toolCallId.length <= 512 ? tool.toolCallId : undefined;
    if (!id) continue;
    const details = record(tool.delegation);
    const parsed = Object.keys(details).length ? readDelegationDetails({ rawInput: { subagent_type: details.role, description: details.title, model: details.model, run_in_background: details.background }, rawOutput: { usage: { total_tokens: details.totalTokens } } }) : readDelegationDetails(tool);
    const previous = tasks.get(id);
    if (!previous && (!parsed?.role || tasks.size >= 100)) continue;
    const task: DelegatedTask = { id, title: parsed?.title ?? parsed?.role ?? "Delegated task", status: "unknown", ...previous, ...parsed };
    if (tool.status === "pending") task.status = "pending";
    if (tool.status === "in_progress") task.status = "running";
    if (tool.status === "completed") task.status = "completed";
    if (tool.status === "failed") task.status = "failed";
    task.activity = label(tool.title) ?? task.activity;
    tasks.set(id, task);
  }
  return [...tasks.values()];
}

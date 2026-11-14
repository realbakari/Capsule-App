import { readToolActivityDetails } from "./tool-activity.js";
import type { RunEvent } from "./types.js";

/** The file a tool event says the agent is reading or editing, and the event that said so. */
export interface AgentFile {
  path: string;
  eventId: string;
}

const FOLLOWED_KINDS = new Set(["read", "edit"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * One file from one tool event, or nothing. Only reads and edits count: a
 * search or a command reports paths it looked through, not a file it is on.
 * A failed call is not followed.
 */
export function agentFileFromEvent(event: RunEvent): string | undefined {
  const outer = record(event.data);
  const data = { ...record(outer.data), ...outer };
  const stream = String(data.streamKind ?? event.type);
  if (!/^(tool|patch)(?:[._-]|$)/u.test(stream)) return undefined;
  if (data.status === "failed" || event.type.endsWith(".failed")) return undefined;
  const input = record(data.rawInput);
  const named = [input.file_path, input.filePath, input.path].find((value): value is string => typeof value === "string" && value.length > 0);
  const kind = typeof data.kind === "string" ? data.kind.toLowerCase() : undefined;
  if (kind ? !FOLLOWED_KINDS.has(kind) : !named) return undefined;
  const locations = readToolActivityDetails(data).locations ?? [];
  return locations.at(-1) ?? named;
}

/** The newest file the agent touched in this run. */
export function latestAgentFile(events: readonly RunEvent[], runId: string): AgentFile | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.runId !== runId) continue;
    const path = agentFileFromEvent(event);
    if (path) return { path, eventId: event.id };
  }
  return undefined;
}

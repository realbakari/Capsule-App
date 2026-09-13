import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { cleanActivityDetail } from "./activity";

export interface ToolObservation {
  id: string;
  timestamp: string;
  title: string;
  command: boolean;
  status: "running" | "waiting" | "completed" | "failed" | "reported";
}

export type TranscriptRow =
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "activity"; id: string; tools: ToolObservation[] };

const MAX_VISIBLE_TOOLS = 100;

/** One invocation stays at its first observation, even when completion arrives later. */
export function turnTranscript(messages: ChatMessage[], events: RunEvent[], run: Run) {
  const calls = new Map<string, ToolObservation>();
  for (const event of events) {
    if (event.runId !== run.id) continue;
    const nested = event.data?.data;
    const data = { ...(nested && typeof nested === "object" ? nested : {}), ...event.data };
    const stream = String(data.streamKind ?? event.type);
    if (!/^(tool|command|patch)(?:[._-]|$)/u.test(stream)) continue;
    const callId = typeof data.toolCallId === "string" && data.toolCallId ? data.toolCallId : undefined;
    // A completion without an invocation ID cannot safely be counted as a new call.
    if (!callId && /\.(completed|failed|done)$/u.test(event.type)) continue;
    const id = callId ?? event.id;
    const previous = calls.get(id);
    const text = event.message || (typeof data.text === "string" ? data.text : "");
    const title = cleanActivityDetail(text) ?? previous?.title ?? "Tool activity";
    const status = String(data.status ?? event.type.split(".")[1] ?? "");
    const reported = status === "failed" ? "failed"
      : /^(completed|done)$/u.test(status) ? "completed"
        : /^(in_progress|running)$/u.test(status) ? "running"
          : status === "pending" ? "waiting" : previous?.status ?? "reported";
    calls.set(id, {
      id, timestamp: previous?.timestamp ?? event.timestamp, title,
      command: data.kind === "execute" || stream === "command" || previous?.command === true
        || /^(execute|run|ran|exec|bash|shell|sh|git|gh|ls|rg|grep)\b/iu.test(title),
      status: reported,
    });
  }
  const partial = calls.size > MAX_VISIBLE_TOOLS || events.some((event) => event.runId === run.id && event.data?.earlierEvents);
  const tools = [...calls.values()].slice(-MAX_VISIBLE_TOOLS);
  const entries = [
    ...messages.map((message, order) => ({ kind: "message" as const, message, time: Date.parse(message.createdAt), order })),
    ...tools.map((tool, order) => ({ kind: "tool" as const, tool, time: Date.parse(tool.timestamp), order: messages.length + order })),
  ];
  // Legacy rows without timestamps stay in input order at the end. Mixing a
  // pairwise fallback with chronological order would make the sort unstable.
  const sortableTime = (time: number) => Number.isFinite(time) ? time : Number.MAX_VALUE;
  entries.sort((a, b) => sortableTime(a.time) - sortableTime(b.time) || a.order - b.order);
  const rows: TranscriptRow[] = [];
  for (const entry of entries) {
    if (entry.kind === "message") rows.push({ kind: "message", id: entry.message.id, message: entry.message });
    else {
      const last = rows.at(-1);
      if (last?.kind === "activity") last.tools.push(entry.tool);
      else rows.push({ kind: "activity", id: `activity:${entry.tool.id}`, tools: [entry.tool] });
    }
  }
  return { rows, partial, hasActivity: tools.length > 0 };
}

export function toolObservationState(tool: ToolObservation, run: Run, stopping = false): string {
  if (tool.status === "failed") return "Failed";
  if (tool.status === "completed") return "Completed";
  if (run.status === "cancelled") return "Stopped";
  if (run.completedAt || ["completed", "failed", "blocked"].includes(run.status)) return "Completion not reported";
  if (stopping) return "Stopping";
  return tool.status === "running" ? "Running" : tool.status === "waiting" ? "Waiting" : "Reported";
}

export function toolGroupLabel(tools: ToolObservation[]): string {
  const commands = tools.filter((tool) => tool.command).length;
  const others = tools.length - commands;
  return [commands ? `${commands} command${commands === 1 ? "" : "s"}` : "", others ? `${others} tool${others === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

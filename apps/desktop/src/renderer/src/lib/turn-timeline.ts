import type { ChatMessage, ReasoningSummary, Run, RunEvent } from "@capsule/shared";
import { readToolActivityDetails, type ToolActivityDetails, type ToolKind } from "@capsule/shared";
import { cleanActivityDetail } from "./activity";

export type { ToolKind };

export interface ToolObservation {
  id: string;
  timestamp: string;
  title: string;
  command: boolean;
  kind: ToolKind;
  status: "running" | "waiting" | "completed" | "failed" | "reported";
  details?: ToolActivityDetails;
}

/**
 * What else the work log keeps beside tool calls: the agent's reasoning, a
 * person's answer to an approval or question, and a context compaction. Each
 * is one quiet row; none of them is the agent's reply.
 */
export type WorkNote =
  | { kind: "reasoning"; id: string; timestamp: string; text: string }
  | { kind: "decision"; id: string; timestamp: string; outcome: "allowed" | "allowed-session" | "denied" | "unanswered" | "answered"; subject: string; detail?: string }
  | { kind: "compaction"; id: string; timestamp: string; active: boolean; automatic: boolean };

export type TranscriptRow =
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "activity"; id: string; tools: ToolObservation[] }
  | { kind: "note"; id: string; note: WorkNote };

const SETTLED_STATUSES: ReadonlyArray<Run["status"]> = ["completed", "failed", "cancelled", "blocked"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A note from one event, or nothing when the event is not one a person needs in the log. */
function workNote(event: RunEvent, data: Record<string, unknown>, stream: string, settled: boolean, reasoning: ReasoningSummary): WorkNote | undefined {
  const base = { id: event.id, timestamp: event.timestamp };
  if (stream === "thinking" || /^(think|thought|reason)/u.test(event.type)) {
    // The live steps card shows reasoning while the turn runs; the log keeps it after.
    const body = event.message || text(data.text);
    return settled && reasoning !== "hidden" && body ? { ...base, kind: "reasoning", text: data.segment === true ? `${body.trim()}\n\n` : body } : undefined;
  }
  if (stream === "compaction" || event.type === "compaction") {
    return { ...base, kind: "compaction", active: !settled && data.phase === "start", automatic: data.trigger !== "manual" };
  }
  // Only the engine's record carries a decision; a runtime's own "approval.resolved" frame is not one.
  if (event.type === "approval.resolved" && typeof data.decision === "string") {
    const outcome = data.question === true ? "unanswered" : data.decision === "denied" ? "denied"
      : data.decision === "approved_session" ? "allowed-session" : "allowed";
    return { ...base, kind: "decision", outcome, subject: text(data.action) ?? "Request", ...(text(data.target) ? { detail: text(data.target) } : {}) };
  }
  if (event.type === "question.answered" && Array.isArray(data.questions)) {
    const answers = data.questions.flatMap((row) => row && typeof row === "object" && typeof (row as { answer?: unknown }).answer === "string"
      ? [{ question: String((row as { question?: unknown }).question ?? ""), answer: (row as { answer: string }).answer }] : []);
    if (!answers.length) return undefined;
    return { ...base, kind: "decision", outcome: "answered",
      subject: answers.length === 1 ? answers[0]!.answer : `${answers.length} questions`,
      detail: answers.map((row) => `${row.question}: ${row.answer}`).join("\n") };
  }
  return undefined;
}

const MAX_VISIBLE_TOOLS = 100;

/** One invocation stays at its first observation, even when completion arrives later. */
export function turnTranscript(messages: ChatMessage[], events: RunEvent[], run: Run, options?: { reasoning?: ReasoningSummary }) {
  const calls = new Map<string, ToolObservation>();
  const notes: WorkNote[] = [];
  const settled = SETTLED_STATUSES.includes(run.status) || Boolean(run.completedAt);
  for (const event of events) {
    if (event.runId !== run.id) continue;
    const nested = event.data?.data;
    const data: Record<string, unknown> = { ...(nested && typeof nested === "object" ? nested : {}), ...event.data };
    const stream = String(data.streamKind ?? event.type);
    if (!/^(tool|command|patch)(?:[._-]|$)/u.test(stream)) {
      const note = workNote(event, data, stream, settled, options?.reasoning ?? "visible");
      if (note) notes.push(note);
      continue;
    }
    const callId = typeof data.toolCallId === "string" && data.toolCallId ? data.toolCallId : undefined;
    // A completion without an invocation ID cannot safely be counted as a new call.
    if (!callId && /\.(completed|failed|done)$/u.test(event.type)) continue;
    const id = callId ?? event.id;
    const previous = calls.get(id);
    const text = typeof data.title === "string" ? data.title : previous?.title || event.message || (typeof data.text === "string" ? data.text : "");
    const title = cleanActivityDetail(text) ?? previous?.title ?? "Tool activity";
    const status = String(data.status ?? event.type.split(".")[1] ?? "");
    const reported = status === "failed" ? "failed"
      : /^(completed|done)$/u.test(status) ? "completed"
        : /^(in_progress|running)$/u.test(status) ? "running"
          : status === "pending" ? "waiting" : previous?.status ?? "reported";
    const command = data.kind === "execute" || stream === "command" || previous?.command === true
      || /^(execute|run|ran|exec|bash|shell|sh|git|gh|ls|rg|grep)\b/iu.test(title);
    const inferred = toolKindFrom(data.kind, title, command);
    const next = readToolActivityDetails(data);
    // New output replaces the old whole: a tail from an earlier snapshot must not hang off a later head.
    const kept = next.output === undefined ? previous?.details : { ...previous?.details, outputTail: undefined, omittedLines: undefined };
    calls.set(id, {
      id, timestamp: previous?.timestamp ?? event.timestamp, title, command,
      kind: inferred !== "other" ? inferred : previous?.kind ?? inferred,
      status: reported,
      details: { ...kept, ...next },
    });
  }
  const partial = calls.size > MAX_VISIBLE_TOOLS || events.some((event) => event.runId === run.id && event.data?.earlierEvents);
  const tools = [...calls.values()].slice(-MAX_VISIBLE_TOOLS);
  const entries = [
    ...messages.map((message, order) => ({ kind: "message" as const, message, time: Date.parse(message.createdAt), order })),
    ...tools.map((tool, order) => ({ kind: "tool" as const, tool, time: Date.parse(tool.timestamp), order: messages.length + order })),
    ...notes.map((note, order) => ({ kind: "note" as const, note, time: Date.parse(note.timestamp), order: messages.length + tools.length + order })),
  ];
  // Legacy rows without timestamps stay in input order at the end. Mixing a
  // pairwise fallback with chronological order would make the sort unstable.
  const sortableTime = (time: number) => Number.isFinite(time) ? time : Number.MAX_VALUE;
  entries.sort((a, b) => sortableTime(a.time) - sortableTime(b.time) || a.order - b.order);
  const rows: TranscriptRow[] = [];
  for (const entry of entries) {
    if (entry.kind === "message") rows.push({ kind: "message", id: entry.message.id, message: entry.message });
    else if (entry.kind === "note") {
      // Reasoning streams in pieces and a compaction can report its start and end: each stretch is one row.
      const last = rows.at(-1);
      if (last?.kind === "note" && last.note.kind === "reasoning" && entry.note.kind === "reasoning") last.note = { ...last.note, text: last.note.text + entry.note.text };
      else if (last?.kind === "note" && last.note.kind === "compaction" && entry.note.kind === "compaction") last.note = { ...entry.note, id: last.note.id };
      else rows.push({ kind: "note", id: `note:${entry.note.id}`, note: entry.note });
    } else {
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

export function toolKindFrom(kind: unknown, title: string, command: boolean): ToolKind {
  const reported = typeof kind === "string" ? kind.toLowerCase() : "";
  if (reported === "read") return "read";
  if (reported === "edit") return "edit";
  if (reported === "delete") return "delete";
  if (reported === "move") return "move";
  if (reported === "switch_mode") return "switch_mode";
  if (reported === "search") return "search";
  if (reported === "execute") return "execute";
  if (reported === "think") return "think";
  if (reported === "fetch") return "fetch";
  if (command) return "execute";
  const text = title.toLowerCase();
  if (text.includes("todo") || /\bplan\b/.test(text)) return "todo";
  if (/^read\b|\bread_file\b|\bfileread\b/.test(text)) return "read";
  if (/\b(edit|write|patch|strreplace|apply_patch)\b/.test(text)) return "edit";
  if (/\b(grep|glob|search|find)\b/.test(text)) return "search";
  if (/\b(web|fetch|http|browse)\b/.test(text)) return "fetch";
  if (/\b(bash|shell|exec|command|terminal)\b/.test(text)) return "execute";
  if (/\bthink\b/.test(text)) return "think";
  if (/\b(delete|unlink)\b/.test(text)) return "delete";
  if (/\b(move|rename)\b/.test(text)) return "move";
  return "other";
}

export function toolKindOrder(tools: ToolObservation[]): ToolKind[] {
  const seen = new Set<ToolKind>();
  const order: ToolKind[] = [];
  for (const tool of tools) {
    if (seen.has(tool.kind)) continue;
    seen.add(tool.kind);
    order.push(tool.kind);
  }
  return order;
}

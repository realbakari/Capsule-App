import type { ReasoningSummary, RunEvent } from "@capsule/shared";

/*
 * Activity is derived from what the agent actually did, not from a fixed
 * script. The Gateway tags each frame with a stream kind (thinking, plan,
 * tool, command, patch); the adapter forwards it as `data.streamKind`. The
 * five hardcoded labels this replaces ("Understanding request", "Selecting
 * agent", …) advanced on Capsule's own lifecycle events and told you nothing
 * about the run.
 */
const ACTIVITY_LABELS: Record<string, string> = {
  thinking: "Thinking",
  plan: "Planning",
  tool: "Running tools",
  command: "Running commands",
  patch: "Editing files",
  message: "Writing a reply",
  error: "Error",
  lifecycle: "Working",
};

/**
 * Not every source tags a frame with a stream kind — the mock runtime and
 * older Gateway builds only carry an event type. Recover a kind from the type
 * so activity still renders instead of silently collapsing to nothing.
 */
function kindFromEventType(type: string): string {
  const key = type.trim().toLowerCase();
  if (key.startsWith("tool")) return "tool";
  if (key.startsWith("think") || key.startsWith("thought") || key.startsWith("reason")) {
    return "thinking";
  }
  if (key.startsWith("plan")) return "plan";
  if (key.startsWith("patch") || key.startsWith("diff")) return "patch";
  if (key === "assistant") return "message";
  // lifecycle, approval.*, cancelled, contract, route … are chrome, not activity.
  return "";
}

/*
 * Work is summarised, not transcribed: a run of tool frames collapses into one
 * counted line — `Read 4 files`, `Ran 3 commands` — rather than listing every
 * call. A phase therefore carries how many frames it absorbed, and the label is
 * derived from that count rather than being a fixed string.
 */
type WorkAction = "read" | "changed" | "ran" | "used";

/** Reads the action out of a tool frame's own text, e.g. `read_file README.md`. */
function workAction(kind: string, message: string | undefined): WorkAction | undefined {
  if (kind === "patch") return "changed";
  if (kind === "command") return "ran";
  if (kind !== "tool") return undefined;
  const text = (message ?? "").trim().toLowerCase();
  if (/^(read|cat|open|view|get)[_\s-]|^read\b/.test(text)) return "read";
  if (/^(write|edit|apply|patch|create|update|replace)[_\s-]/.test(text)) return "changed";
  if (/^(bash|run|exec|shell|sh)[_\s-]|^ls\b|^rg\b|^grep\b/.test(text)) return "ran";
  return "used";
}

function workLabel(action: WorkAction, count: number): string {
  const plural = (one: string, many: string) => (count === 1 ? one : many);
  switch (action) {
    case "read":
      return `Read ${count} ${plural("file", "files")}`;
    case "changed":
      return `Changed ${count} ${plural("file", "files")}`;
    case "ran":
      return `Ran ${count} ${plural("command", "commands")}`;
    default:
      return `Used ${count} ${plural("tool", "tools")}`;
  }
}

export interface RunActivity {
  id: string;
  label: string;
  detail?: string;
  /** How many frames this phase absorbed; drives the counted work label. */
  count: number;
  /**
   * The phase's full text, joined across every frame it absorbed. Reasoning
   * arrives as a stream of chunks, so the one-line `detail` shows the latest
   * fragment while this holds the whole thing for anyone who opens it.
   */
  body?: string;
  status: "active" | "complete" | "error";
}

/**
 * Collapses the event stream into consecutive activity phases, newest last.
 * Repeated frames of the same kind fold into one row so a long tool sequence
 * does not scroll the transcript away.
 */
export function activityFromEvents(
  events: RunEvent[],
  runFinished: boolean,
  options?: { reasoning?: ReasoningSummary },
): RunActivity[] {
  const reasoning = options?.reasoning ?? "visible";
  const phases: RunActivity[] = [];
  for (const event of events) {
    const kind = String(event.data?.streamKind ?? "") || kindFromEventType(event.type);
    if (!kind || kind === "lifecycle") continue;
    if (kind === "thinking" && reasoning === "hidden") continue;
    /*
     * `tool.completed` / `tool.failed` report the end of the call the previous
     * frame started; they are not a second piece of work, so they fold into the
     * open group instead of opening a "Used 1 tool" row beside it.
     *
     * A failure has to leave a mark on the way in, though. Folding it away
     * silently left a tool that failed reading as "Read 1 file", complete, with
     * nothing anywhere to say it had not worked.
     */
    const type = event.type.trim().toLowerCase();
    const isCompletionFrame = /\.(completed|failed|done)$/.test(type);
    const openWork = phases.at(-1);
    if (isCompletionFrame && openWork?.id.startsWith("work:")) {
      if (/\.failed$/.test(type)) {
        openWork.status = "error";
        const reason = event.message?.trim().split("\n")[0]?.slice(0, 120);
        if (reason) openWork.detail = reason;
      }
      continue;
    }
    const action = workAction(kind, event.message);
    // Work phases group by action so `read_file a` and `read_file b` are one
    // "Read 2 files" row; everything else groups by kind as before.
    const groupId = action ? `work:${action}` : kind;
    const detail =
      kind === "thinking" && reasoning === "collapsed"
        ? undefined
        : event.message?.trim().split("\n")[0]?.slice(0, 120) || undefined;
    // Reasoning streams in fragments; keep every one so the full thought is
    // readable rather than only its first 120 characters.
    const chunk = kind === "thinking" ? event.message?.trim() : undefined;
    const last = phases.at(-1);
    if (last && last.id === groupId) {
      last.count += 1;
      if (action) last.label = workLabel(action, last.count);
      // Keep the most recent line for this phase rather than appending a row.
      if (detail) last.detail = detail;
      if (chunk) last.body = last.body ? `${last.body}\n${chunk}` : chunk;
      continue;
    }
    phases.push({
      id: groupId,
      label: action ? workLabel(action, 1) : (ACTIVITY_LABELS[kind] ?? ACTIVITY_LABELS.lifecycle!),
      ...(detail ? { detail } : {}),
      ...(chunk ? { body: chunk } : {}),
      count: 1,
      status: kind === "error" ? "error" : "active",
    });
  }
  return phases.map((phase, index) => ({
    ...phase,
    status:
      phase.status === "error"
        ? "error"
        : index < phases.length - 1 || runFinished
          ? "complete"
          : "active",
  }));
}

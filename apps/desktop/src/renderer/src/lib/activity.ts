import type { GitStatus, ReasoningSummary, RunEvent } from "@capsule/shared";
import { toWorkspaceRelative } from "./paths.js";

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

/**
 * The readable part of a frame's text.
 *
 * Harnesses narrate their own plumbing: "Read File (pending)", "tool call
 * (completed): ```console …", a fenced block where a filename was expected.
 * Printed verbatim under a row that already says "Read 1 file", that is noise
 * at best and a contradiction at worst — a completed row is not pending.
 */
export function cleanActivityDetail(message: string | undefined): string | undefined {
  let text = (message ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (!text) return undefined;
  // "tool call (completed): …", "tool call: …"
  text = text.replace(/^tool[_\s-]?call\s*(\([a-z]+\))?\s*:\s*/iu, "");
  // A fence, with or without a language, wherever it starts.
  text = text.replace(/```+\s*[a-z0-9]*\s*/giu, " ");
  // The status a frame carries about itself; the row's own glyph says this.
  text = text.replace(/\s*\((pending|completed|running|failed|done)\)\s*/giu, " ");
  text = text.replace(/\s+/gu, " ").trim();
  if (!text || text.length < 2) return undefined;
  // 120 is the width these rows were already cut to; a row is one line.
  return text.slice(0, 120);
}

/**
 * Whether a detail is worth printing beside a label that already says it.
 * "Read 1 file · Read File" is the row twice; the second half is the tool's
 * own name, not what it was pointed at.
 */
export function detailAddsSomething(label: string, detail: string | undefined): boolean {
  if (!detail) return false;
  const simplify = (value: string) => value.toLowerCase().replace(/[^a-z]+/gu, "");
  const plain = simplify(detail);
  return plain.length > 0 && !simplify(label).includes(plain);
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
        const reason = cleanActivityDetail(event.message);
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
        : cleanActivityDetail(event.message);
    // Reasoning streams in fragments; keep every one so the full thought is
    // readable rather than only its first 120 characters.
    const chunk = kind === "thinking" ? event.message?.trim() : undefined;
    const last = phases.at(-1);
    if (last && last.id === groupId) {
      last.count += 1;
      if (action) last.label = workLabel(action, last.count);
      // Keep the most recent line for this phase rather than appending a row,
      // and only when it says more than the label does.
      if (detail && detailAddsSomething(last.label, detail)) last.detail = detail;
      if (chunk) last.body = last.body ? `${last.body}\n${chunk}` : chunk;
      continue;
    }
    const label = action ? workLabel(action, 1) : (ACTIVITY_LABELS[kind] ?? ACTIVITY_LABELS.lifecycle!);
    phases.push({
      id: groupId,
      label,
      ...(detailAddsSomething(label, detail) ? { detail } : {}),
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

export interface WorkSummary {
  /** Shell commands the agent ran. */
  commands: number;
  /** Other tool calls: reads, edits, everything that is not a command. */
  tools: number;
  label: string;
}

/**
 * Totals for a turn's work, from the phases the activity log already folded.
 *
 * Two things make this easy to get wrong, and both did. A phase is a *group* —
 * "Read 12 files" is one row carrying `count: 12` — so counting rows reports 1
 * where 12 happened. And a command phase is still a phase, so a filter of
 * "everything that is not thinking" counts it as a tool as well as a command.
 * Commands and tools are disjoint here, and both read `count`.
 */
export function summariseWork(phases: readonly RunActivity[]): WorkSummary {
  let commands = 0;
  let tools = 0;
  for (const phase of phases) {
    if (phase.id === "thinking") continue;
    // The id carries the action; the label is display text and can be retitled
    // or translated without anyone remembering this depends on it.
    if (phase.id === "work:ran") commands += phase.count;
    else tools += phase.count;
  }

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const label =
    commands > 0 && tools > 0
      ? `Ran ${plural(commands, "command")} and used ${plural(tools, "tool")}`
      : commands > 0
        ? `Ran ${plural(commands, "command")}`
        : tools > 0
          ? `Used ${plural(tools, "tool")}`
          : "";

  return { commands, tools, label };
}

export interface TouchedFile {
  path: string;
  action: "created" | "modified" | "deleted" | "read";
  added?: number;
  removed?: number;
}

const FILE_ACTION_PRIORITY: Record<TouchedFile["action"], number> = {
  created: 4,
  modified: 3,
  deleted: 2,
  read: 1,
};

function cleanExtractedPath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/^[`"']+|[`"']+$/g, "");
  p = p.replace(/[:.,;!?)]+$/, "");
  return p.trim();
}

function isValidFilePath(p: string): boolean {
  if (!p || p.length < 2) return false;
  if (p.startsWith("http://") || p.startsWith("https://")) return false;
  if (p.startsWith("-") || p.startsWith("--")) return false;
  if (/^(the|a|an|this|that|these|those|file|files|it|all|some|any|null|undefined|true|false)$/i.test(p)) return false;
  return /\.[a-z0-9_-]+$/i.test(p) || p.includes("/") || p.includes("\\") || p.startsWith(".");
}

const FILE_ACTION_PATTERNS: Array<{
  pattern: RegExp;
  action: TouchedFile["action"];
}> = [
  { pattern: /(?:create[_\s-]?file|created|touch|add[_\s-]?file)\s*[:=]?\s*[`"']?([^\s,;'"`)]+)/i, action: "created" },
  { pattern: /(?:write[_\s-]?to[_\s-]?file|write[_\s-]?file|writing|wrote|written)\s*[:=]?\s*(?:to\s+)?(?:file\s+)?[`"']?([^\s,;'"`)]+)/i, action: "modified" },
  { pattern: /(?:edit[_\s-]?file|editing|edited|patch[_\s-]?file|patch|diff|update[_\s-]?file|updated|replace[_\s-]?file[_\s-]?content)\s*[:=]?\s*[`"']?([^\s,;'"`)]+)/i, action: "modified" },
  { pattern: /(?:delete[_\s-]?file|deleted|remove[_\s-]?file|removed|rm)\s*[:=]?\s*[`"']?([^\s,;'"`)]+)/i, action: "deleted" },
  { pattern: /(?:read[_\s-]?file|reading|read|view[_\s-]?file|viewing|view|cat|open[_\s-]?file)\s*[:=]?\s*[`"']?([^\s,;'"`)]+)/i, action: "read" },
];

export function extractTouchedFiles(
  events: readonly RunEvent[],
  git?: GitStatus,
  workspaceDir?: string,
): TouchedFile[] {
  const map = new Map<string, TouchedFile>();

  const register = (
    rawPath: string,
    action: TouchedFile["action"],
    added?: number,
    removed?: number,
  ) => {
    const cleaned = cleanExtractedPath(rawPath);
    if (!isValidFilePath(cleaned)) return;
    const rel = toWorkspaceRelative(cleaned, workspaceDir);
    if (!rel || rel === "." || rel.length < 2) return;

    const existing = map.get(rel);
    if (existing) {
      if (FILE_ACTION_PRIORITY[action] > FILE_ACTION_PRIORITY[existing.action]) {
        existing.action = action;
      }
      if (added !== undefined) existing.added = added;
      if (removed !== undefined) existing.removed = removed;
    } else {
      map.set(rel, {
        path: rel,
        action,
        ...(added !== undefined ? { added } : {}),
        ...(removed !== undefined ? { removed } : {}),
      });
    }
  };

  // 1. Git status: real files on disk changed in this worktree
  if (git?.files) {
    for (const f of git.files) {
      const code = f.code.trim()[0] || "";
      let action: TouchedFile["action"] = "modified";
      if (code === "?" || code === "A") action = "created";
      else if (code === "D") action = "deleted";
      else if (code === "M" || code === "R") action = "modified";
      register(f.path, action, f.added, f.removed);
    }
  }

  // 2. Run events: tool calls, parameters, and messages
  for (const event of events) {
    const data = event.data;
    if (data && typeof data === "object") {
      const rawData = data as Record<string, unknown>;
      const directPath =
        (typeof rawData.path === "string" && rawData.path) ||
        (typeof rawData.filePath === "string" && rawData.filePath) ||
        (typeof rawData.targetFile === "string" && rawData.targetFile) ||
        (typeof rawData.file === "string" && rawData.file);
      if (directPath) {
        const streamKind = String(rawData.streamKind ?? event.type).toLowerCase();
        let action: TouchedFile["action"] = "modified";
        if (streamKind.includes("create")) action = "created";
        else if (streamKind.includes("read") || streamKind.includes("view")) action = "read";
        else if (streamKind.includes("delete") || streamKind.includes("remove")) action = "deleted";
        register(directPath, action);
      }

      const toolCall = rawData.toolCall as Record<string, unknown> | undefined;
      if (toolCall && typeof toolCall === "object") {
        const params = (toolCall.parameters ?? toolCall.input ?? toolCall.args) as
          | Record<string, unknown>
          | undefined;
        const toolName = String(toolCall.name ?? "").toLowerCase();
        const p =
          params &&
          ((typeof params.path === "string" && params.path) ||
            (typeof params.filePath === "string" && params.filePath) ||
            (typeof params.targetFile === "string" && params.targetFile) ||
            (typeof params.file === "string" && params.file));
        if (p) {
          let action: TouchedFile["action"] = "modified";
          if (toolName.includes("create") || toolName.includes("write")) action = "created";
          else if (toolName.includes("read") || toolName.includes("view") || toolName.includes("cat")) action = "read";
          else if (toolName.includes("delete") || toolName.includes("remove")) action = "deleted";

          const rawCode =
            typeof params?.content === "string"
              ? params.content
              : typeof params?.codeContent === "string"
                ? params.codeContent
                : typeof params?.replacementContent === "string"
                  ? params.replacementContent
                  : undefined;
          const addedLines =
            rawCode !== undefined ? (rawCode.length > 0 ? rawCode.split(/\r?\n/).length : 0) : undefined;
          register(p, action, addedLines);
        }
      }
    }

    const msg = event.message?.trim();
    if (msg) {
      const lineMatch = /(?:\+(\d+)|\b(\d+)\s+lines?\b)/i.exec(msg);
      const addedFromMsg = lineMatch ? Number(lineMatch[1] || lineMatch[2]) : undefined;
      for (const rule of FILE_ACTION_PATTERNS) {
        const match = rule.pattern.exec(msg);
        if (match && match[1]) {
          register(match[1], rule.action, addedFromMsg);
        }
      }
    }
  }

  return Array.from(map.values());
}

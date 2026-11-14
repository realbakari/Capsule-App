import type { ChatMessage, Run, RunEvent, Session, TurnDiffResult } from "./types.js";
import { finalMessages } from "./composer-context.js";

/*
 * A thread as a Markdown document someone can paste into an issue or keep.
 *
 * threadToMarkdown in composer-context is the same thread written for an
 * agent: budget-capped, newest turns kept. This one is for a person: every
 * turn, a header, and optionally tool activity and changed files. Both keep
 * the same messages (prompts, steers and each turn's final reply).
 *
 * Deterministic on purpose: the same thread exports to the same bytes, so an
 * export can be diffed, and nothing depends on the clock or the locale of the
 * machine that made it. Local file paths never appear: an attachment is named,
 * not located.
 */

export interface ThreadMarkdownOptions {
  /** Each turn's tool calls as a compact list. Off by default. */
  includeToolActivity?: boolean;
  /** Each turn's changed files with line counts. */
  includeChangedFiles?: boolean;
}

export interface ThreadMarkdownInput extends ThreadMarkdownOptions {
  /** The agent's display name; the session only carries its id. */
  agentName?: string;
  projectName?: string;
  /** Run events for the thread's turns, read when tool activity is included. */
  events?: readonly RunEvent[];
  /** Changed files per run id, read when changed files are included. */
  changedFiles?: Readonly<Record<string, TurnDiffResult["files"]>>;
}

interface ToolLine {
  title: string;
  status?: "completed" | "failed";
}

export function threadExportMarkdown(
  session: Session,
  messages: readonly ChatMessage[],
  runs: readonly Run[],
  options: ThreadMarkdownInput = {},
): string {
  const sorted = [...messages]
    .filter((message) => message.sessionId === session.id && message.role !== "system")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // The same messages a thread attached as composer context carries; a prompt that is only an attachment stays.
  const kept = new Set(finalMessages(sorted).map((message) => message.id));
  const ordered = sorted.filter((message) => kept.has(message.id) || (message.role === "user" && message.attachments?.length));
  const runById = new Map(runs.filter((run) => run.sessionId === session.id).map((run) => [run.id, run]));
  const lastIndexOfRun = new Map<string, number>();
  ordered.forEach((message, index) => { if (message.runId) lastIndexOfRun.set(message.runId, index); });
  const answered = new Set(ordered.filter((message) => message.role === "assistant" && message.runId).map((message) => message.runId!));

  const blocks: string[] = [`# ${oneLine(session.title) || "Untitled conversation"}`, header(session, ordered, options)];
  let turn = 0;
  ordered.forEach((message, index) => {
    if (message.role === "user") {
      if (message.kind === "steer") blocks.push(quote(`**Steer:** ${message.content}`));
      else {
        turn += 1;
        blocks.push(`## Turn ${turn}`, message.content.trim() ? quote(message.content) : "");
      }
      const attached = (message.attachments ?? []).map((item) => inlineCode(item.name));
      if (attached.length) blocks.push(`_Attached: ${attached.join(", ")}_`);
    } else {
      blocks.push(message.content.trim() || "_No reply text._");
    }
    const run = message.runId ? runById.get(message.runId) : undefined;
    if (run && lastIndexOfRun.get(run.id) === index) blocks.push(...turnExtras(run, answered.has(run.id), options));
  });
  if (turn === 0) blocks.push("_No messages yet._");
  return `${blocks.filter(Boolean).join("\n\n")}\n`;
}

function header(session: Session, messages: readonly ChatMessage[], options: ThreadMarkdownInput): string {
  const turns = messages.filter((message) => message.role === "user" && message.kind !== "steer").length;
  const rows = [
    ["Agent", options.agentName ?? session.harnessId ?? session.agentId],
    ["Model", session.modelOverride],
    ["Project", options.projectName],
    ["Started", stamp(session.createdAt)],
    ["Turns", String(turns)],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return rows.map(([label, value]) => `- **${label}:** ${oneLine(value)}`).join("\n");
}

function turnExtras(run: Run, answered: boolean, options: ThreadMarkdownInput): string[] {
  const blocks: string[] = [];
  // A turn's text reaches a thread as a reply or as the run's result.
  if (!answered && run.result?.trim()) blocks.push(run.result.trim());
  if (run.status === "failed" && run.error) blocks.push(`_Turn failed: ${oneLine(run.error)}_`);
  if (run.status === "cancelled") blocks.push("_Turn stopped._");
  if (options.includeToolActivity) {
    const tools = toolLines(run.id, options.events ?? []);
    if (tools.length) {
      const failed = tools.filter((tool) => tool.status === "failed").length;
      const summary = `${tools.length} tool call${tools.length === 1 ? "" : "s"}${failed ? ` (${failed} failed)` : ""}`;
      blocks.push([
        "<details>",
        `<summary>${summary}</summary>`,
        "",
        ...tools.map((tool) => `- ${inlineCode(tool.title)}${tool.status === "failed" ? " — failed" : ""}`),
        "",
        "</details>",
      ].join("\n"));
    }
  }
  if (options.includeChangedFiles) {
    const files = options.changedFiles?.[run.id] ?? [];
    if (files.length) {
      blocks.push(["**Changed files**", "", ...files.map((file) => {
        const counts = [file.added ? `+${file.added}` : "", file.removed ? `−${file.removed}` : ""].filter(Boolean).join(" ");
        const status = file.status && file.status !== "modified" ? `${file.status}` : "";
        const detail = [status, counts].filter(Boolean).join(", ");
        return `- ${inlineCode(file.path)}${detail ? ` (${detail})` : ""}`;
      })].join("\n"));
    }
  }
  return blocks;
}

/* One line per tool invocation, in the order calls began, with the latest title and outcome the agent reported. */
function toolLines(runId: string, events: readonly RunEvent[]): ToolLine[] {
  const calls = new Map<string, ToolLine>();
  for (const event of events) {
    if (event.runId !== runId) continue;
    const nested = event.data?.data;
    const data: Record<string, unknown> = { ...(nested && typeof nested === "object" ? nested as Record<string, unknown> : {}), ...event.data };
    const stream = String(data.streamKind ?? event.type);
    if (!/^(tool|command|patch)(?:[._-]|$)/u.test(stream)) continue;
    const callId = typeof data.toolCallId === "string" && data.toolCallId ? data.toolCallId : undefined;
    if (!callId && /\.(completed|failed|done)$/u.test(event.type)) continue;
    const key = callId ?? event.id;
    const previous = calls.get(key);
    const title = oneLine(typeof data.title === "string" && data.title ? data.title : previous?.title ?? event.message) || "Tool call";
    const reported = String(data.status ?? event.type.split(".")[1] ?? "");
    const status = reported === "failed" ? "failed" : /^(completed|done)$/u.test(reported) ? "completed" : previous?.status;
    calls.set(key, { title, ...(status ? { status } : {}) });
  }
  return [...calls.values()];
}

function quote(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/* A code span that survives backticks inside it. */
function inlineCode(text: string): string {
  const value = oneLine(text);
  const longest = Math.max(0, ...[...value.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function stamp(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

import type { ChatMessage, ProjectAction } from "./types.js";
import { clipText } from "./text-budget.js";

/**
 * Context the composer can attach besides plain files.
 *
 * Every source ends the same way: a bounded Markdown document saved as a text
 * attachment, with a chip that names it and previews it. The registry below
 * says what each source is called, what it touches and where it is offered,
 * so the composer, the palette and the context menus read one table instead
 * of each keeping its own list.
 */
export type ContextKind = "thread" | "diff" | "diagnostics" | "url" | "selection" | "command";

/** What resolving a source does beyond reading Capsule's own state. */
export type ContextEffect = "read" | "network" | "command";

export type ContextSurface = "mention" | "palette" | "context-menu" | "bang";

export interface ContextSourceSpec {
  kind: ContextKind;
  /** The word after `@` in the composer, for sources offered there. */
  keyword?: string;
  label: string;
  detail: string;
  effect: ContextEffect;
  surfaces: readonly ContextSurface[];
}

export const CONTEXT_SOURCES: readonly ContextSourceSpec[] = [
  { kind: "thread", keyword: "thread", label: "Conversation", detail: "Attach another conversation's prompts and replies", effect: "read", surfaces: ["mention"] },
  { kind: "diff", keyword: "diff", label: "Diff", detail: "Attach the branch diff or uncommitted changes", effect: "read", surfaces: ["mention"] },
  { kind: "diagnostics", keyword: "diagnostics", label: "Diagnostics", detail: "Run the project's check command and attach what fails", effect: "command", surfaces: ["mention"] },
  { kind: "url", keyword: "url", label: "Web page", detail: "Fetch a page and attach its readable text", effect: "network", surfaces: ["mention"] },
  { kind: "selection", label: "Selection", detail: "Quote selected text from the terminal, a file or the browser", effect: "read", surfaces: ["palette", "context-menu"] },
  { kind: "command", label: "Command output", detail: "Run a shell command and attach its output", effect: "command", surfaces: ["bang"] },
];

export function contextSource(kind: ContextKind): ContextSourceSpec {
  return CONTEXT_SOURCES.find((source) => source.kind === kind)!;
}

/** Sources reachable from `@`, matched by the start of their keyword. */
export function mentionSources(query: string): ContextSourceSpec[] {
  const needle = query.trim().toLowerCase();
  return CONTEXT_SOURCES.filter((source) => source.surfaces.includes("mention") && source.keyword?.startsWith(needle));
}

/** Shown on the chip and in its preview. Lives on the attachment, so a restored draft keeps it. */
export interface ContextAttachment {
  kind: ContextKind;
  label: string;
  /** The first part of the attached text, for the hover preview. */
  excerpt: string;
  detail?: string;
}

/** Each attachment's own cap. Two of these fit the direct route's 3 MB prompt budget with room to spare. */
export const CONTEXT_BYTE_LIMIT = 200 * 1024;
const EXCERPT_CHARS = 1_600;

export interface ResolvedContext {
  context: ContextAttachment;
  /** The Markdown that is saved and sent. */
  text: string;
  fileName: string;
}

export function resolvedContext(kind: ContextKind, label: string, text: string, detail?: string): ResolvedContext {
  const bounded = clipText(text, CONTEXT_BYTE_LIMIT, "head").text;
  return {
    context: { kind, label, excerpt: bounded.slice(0, EXCERPT_CHARS), ...(detail ? { detail } : {}) },
    text: bounded,
    fileName: contextFileName(kind, label),
  };
}

/** Characters a file name cannot hold on any desktop OS, and control characters, become spaces. */
export function safeFileName(name: string): string {
  return Array.from(name, (char) => char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? " " : char).join("").replace(/\s+/gu, " ").trim();
}

export function contextFileName(kind: ContextKind, label: string): string {
  const base = safeFileName(`${contextSource(kind).label} - ${label}`);
  return `${base.slice(0, 80)}.md`;
}

/**
 * A conversation as Markdown: what was asked and what came back.
 *
 * Tool calls, reasoning and status lines live in run events, not messages, so
 * they never reach this. Steers stay: they changed what the agent did. When
 * the transcript is over budget the oldest turns go first, and the document
 * says how many were left out.
 */
export function threadToMarkdown(
  thread: { title: string; project?: string },
  messages: readonly ChatMessage[],
  maxBytes = CONTEXT_BYTE_LIMIT,
): string {
  const entries = finalMessages(messages).map((message) => {
    const heading = message.role === "user" ? message.kind === "steer" ? "Steer" : "Prompt" : "Reply";
    const files = message.attachments?.length ? `\n\n_Attached: ${message.attachments.map((item) => item.name).join(", ")}_` : "";
    return `## ${heading}\n\n${message.content.trim()}${message.contentTruncated ? "\n\n_(cut short in Capsule's history)_" : ""}${files}`;
  });
  const head = `# ${thread.title.trim() || "Conversation"}${thread.project ? `\n\nProject: ${thread.project}` : ""}`;
  const encoder = new TextEncoder();
  let used = encoder.encode(head).length + 64;
  const kept: string[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const size = encoder.encode(entries[index]!).length + 2;
    if (used + size > maxBytes) break;
    kept.unshift(entries[index]!);
    used += size;
  }
  const omitted = entries.length - kept.length;
  const note = omitted ? `\n\n_${omitted} earlier ${omitted === 1 ? "message" : "messages"} left out to fit._` : "";
  if (!kept.length && entries.length) {
    return `${head}${note}\n\n${clipText(entries[entries.length - 1]!, Math.max(1024, maxBytes - used), "tail").text}\n`;
  }
  return `${head}${note}\n\n${kept.join("\n\n")}\n`;
}

/** User prompts, plus the last assistant message of each run: the reply, not the narration before it. */
function finalMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const lastReply = new Map<string, string>();
  for (const message of messages) if (message.role === "assistant" && message.runId) lastReply.set(message.runId, message.id);
  return messages.filter((message) => message.content.trim() && (message.role === "user"
    || (message.role === "assistant" && (!message.runId || lastReply.get(message.runId) === message.id))));
}

export function diffToMarkdown(input: { scope: "branch" | "uncommitted"; patch: string; base?: string }): string {
  const title = input.scope === "branch" ? `Branch diff${input.base ? ` against ${input.base}` : ""}` : "Uncommitted changes";
  const clipped = clipText(input.patch, CONTEXT_BYTE_LIMIT - 512, "head");
  return `# ${title}\n\n\`\`\`diff\n${clipped.text.replace(/\n$/, "")}\n\`\`\`\n${clipped.truncated ? "\n_The diff was cut to fit; ask for the rest if you need it._\n" : ""}`;
}

export interface SharedSelection {
  text: string;
  origin: "terminal" | "file" | "browser";
  /** Workspace-relative path, for a file selection. */
  path?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  url?: string;
  title?: string;
}

export function selectionLabel(selection: SharedSelection): string {
  if (selection.origin === "file" && selection.path) {
    const lines = selection.startLine ? `:${selection.startLine}${selection.endLine && selection.endLine !== selection.startLine ? `-${selection.endLine}` : ""}` : "";
    return `${selection.path}${lines}`;
  }
  if (selection.origin === "browser") return selection.title?.trim() || hostLabel(selection.url) || "Browser";
  return "Terminal";
}

export function selectionToMarkdown(selection: SharedSelection): string {
  const body = clipText(selection.text.replace(/\s+$/u, ""), CONTEXT_BYTE_LIMIT - 1024, "head").text;
  if (selection.origin === "browser") {
    const quoted = body.split("\n").map((line) => `> ${line}`).join("\n");
    return `# Selected from ${selection.title?.trim() || "a web page"}\n\nSource: ${selection.url ?? "unknown page"}\n\n${quoted}\n`;
  }
  const fence = body.includes("```") ? "~~~~" : "```";
  const where = selection.origin === "file" ? `Selected from \`${selectionLabel(selection)}\`` : "Selected from the terminal";
  return `# ${where}\n\n${fence}${selection.origin === "file" ? selection.language ?? "" : "text"}\n${body}\n${fence}\n`;
}

/** Line numbers, 1-based, for a character range inside a file's text. */
export function lineRange(text: string, start: number, end: number): { startLine: number; endLine: number } {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(from, Math.max(start, end));
  const startLine = text.slice(0, from).split("\n").length;
  // A selection that ends right after a newline stops on the line before it.
  const endText = text.slice(0, to);
  const endLine = endText.endsWith("\n") && to > from ? endText.split("\n").length - 1 : endText.split("\n").length;
  return { startLine, endLine: Math.max(startLine, endLine) };
}

/** `!npm test` at the very start of the composer is a command for this machine, not a prompt. */
export function parseBangCommand(draft: string): string | undefined {
  if (!draft.startsWith("!")) return undefined;
  const command = draft.slice(1).trim();
  return command ? command : undefined;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  durationMs: number;
}

export function commandToMarkdown(result: CommandResult, heading = "Command output"): string {
  return `# ${heading}\n\n\`\`\`sh\n$ ${result.command}\n\`\`\`\n\nExit code: ${result.exitCode}${result.truncated ? " (output cut to its last part)" : ""}\n\n\`\`\`text\n${result.output.replace(/\n$/, "") || "(no output)"}\n\`\`\`\n`;
}

/** Combined stdout and stderr, kept to the end where failures usually are. */
export function commandOutput(stdout: string, stderr: string, maxBytes = 64 * 1024): { output: string; truncated: boolean } {
  const joined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");
  const clipped = clipText(joined, maxBytes, "tail");
  return { output: clipped.text, truncated: clipped.truncated };
}

/**
 * Diagnostics are the project's own check, not invented ones.
 *
 * Capsule has no language server. What it can honestly attach is the output of
 * the command the project uses to check itself: an action marked as a check,
 * or a `typecheck`, `lint` or `check` script in package.json.
 */
export interface CheckCommand {
  command: string;
  source: "action" | "script";
  name: string;
}

const CHECK_SCRIPTS = ["typecheck", "lint", "check"] as const;

export function detectCheckCommand(input: {
  actions?: readonly ProjectAction[];
  packageJson?: string;
  lockfiles?: readonly string[];
}): CheckCommand | undefined {
  const action = input.actions?.find((candidate) => candidate.check);
  if (action) return { command: action.command, source: "action", name: action.name };
  if (!input.packageJson) return undefined;
  let scripts: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(input.packageJson) as { scripts?: unknown };
    scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts as Record<string, unknown> : undefined;
  } catch { return undefined; }
  const name = CHECK_SCRIPTS.find((script) => typeof scripts?.[script] === "string" && String(scripts[script]).trim());
  if (!name) return undefined;
  const runner = packageRunner(input.lockfiles ?? []);
  return { command: `${runner} ${name}`, source: "script", name };
}

function packageRunner(lockfiles: readonly string[]): string {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm run";
  if (lockfiles.includes("yarn.lock")) return "yarn run";
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) return "bun run";
  return "npm run";
}

export type DiagnosticsResult =
  | { status: "none" }
  | ({ status: "ran"; check: CheckCommand } & CommandResult);

export function diagnosticsToMarkdown(result: Extract<DiagnosticsResult, { status: "ran" }>): string {
  const verdict = result.exitCode === 0 ? "The check passed." : "The check failed. Its output follows.";
  return `${commandToMarkdown(result, `Diagnostics from ${result.check.name}`)}\n${verdict}\n`;
}

export interface UrlContext {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export function urlToMarkdown(page: UrlContext): string {
  return `# ${page.title || page.url}\n\nSource: ${page.url}\n\n${page.text.trim()}\n${page.truncated ? "\n_The page was cut to fit._\n" : ""}`;
}

export function hostLabel(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).host; } catch { return undefined; }
}

/** Instruction files coding agents look for at a project's root. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "GEMINI.md"] as const;

/**
 * The prompt behind `/init`. It names the instruction files already present so
 * the agent refreshes them instead of writing a rival copy.
 */
export function initPrompt(existing: readonly string[]): string {
  const found = existing.length
    ? `This project already has ${existing.map((file) => `\`${file}\``).join(", ")}. Read ${existing.length === 1 ? "it" : "them"} first. Keep what is still true, fix what is stale, and fold the useful parts into AGENTS.md. Leave other agents' files in place unless they only duplicate AGENTS.md.`
    : "This project has no agent instruction file yet.";
  return [
    "Write or refresh AGENTS.md at the project root: the file coding agents read at the start of every turn.",
    "",
    found,
    "",
    "Explore the repository before writing. Then cover, briefly:",
    "- What the project is and how the code is laid out, in a few lines.",
    "- The exact commands to install, build, test, lint and typecheck, taken from the project's own scripts and config. Run them if they are quick, and say which ones you confirmed.",
    "- Conventions a newcomer would get wrong: naming, module boundaries, error handling, test style, commit messages.",
    "- Anything that must not be done, and why.",
    "",
    "Keep it under 200 lines. Prefer concrete commands and paths to general advice. Do not restate what the code already makes obvious. When you are done, summarize what you added or changed.",
  ].join("\n");
}

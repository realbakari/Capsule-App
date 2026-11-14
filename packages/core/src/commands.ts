import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandCatalog, CommandEntry } from "@capsule/config";
import { MAX_MESSAGE_ATTACHMENTS, validateMessageAttachments } from "@capsule/filesystem";
import {
  createId,
  expandCommandTemplate,
  shellSpanCommands,
  spliceShellOutputs,
  type CommandSummary,
  type CustomizationRunRecord,
  type MessageAttachment,
  type ShellSpan,
} from "@capsule/shared";
import { runCapped, type CappedRun } from "@capsule/terminal";

/*
 * Capsule expands its own commands before a turn reaches the agent, so one
 * library works for every agent, on both routes, from the desktop or a
 * paired device. The agent only ever sees the resulting prompt text.
 */

export const COMMAND_SHELL_TIMEOUT_MS = 10_000;
export const COMMAND_SHELL_MAX_BYTES = 16 * 1024;
export const UNTRUSTED_SHELL = "(not run: trust this project to run shell in commands)";

const INVOCATION = /^\/([a-z0-9][a-z0-9:_-]*)(?:\s+([\s\S]*))?$/;

/** `/name arguments` as typed. Whether `name` is a command is the catalog's answer. */
export function readInvocation(text: string): { name: string; args: string } | undefined {
  const match = INVOCATION.exec(text.trim());
  return match ? { name: match[1]!, args: match[2] ?? "" } : undefined;
}

export interface CommandCall {
  entry: CommandEntry;
  args: string;
}

export function findCommandCall(catalog: CommandCatalog, text: string): CommandCall | undefined {
  const invocation = readInvocation(text);
  const entry = invocation && catalog.commands.find((item) => item.command.name === invocation.name);
  return entry && invocation ? { entry, args: invocation.args } : undefined;
}

/** A project command's shell waits until its folder is trusted; the user's own always runs. */
function shellBlocked(entry: CommandEntry, trusted: boolean): boolean {
  return entry.scope === "project" && !trusted;
}

export function summarizeCommand(entry: CommandEntry, trusted: boolean): CommandSummary {
  const { command } = entry;
  const shell = shellSpanCommands(command.body).length === 0 ? "none" : shellBlocked(entry, trusted) ? "needs-trust" : "runs";
  return {
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    source: entry.source,
    scope: entry.scope,
    path: entry.path,
    send: command.send,
    shell,
  };
}

/** A command with its arguments in place, its shell spans not yet run. */
export interface PreparedCommand {
  call: CommandCall;
  /** The prompt with a token where each shell span's output goes. */
  text: string;
  shell: ShellSpan[];
  /** Files its `@path` mentions name inside the folder. */
  attachments: MessageAttachment[];
  problems: string[];
}

/**
 * Fill in the arguments and turn `@path` mentions into attachments. `cwd` is
 * the thread's folder: mentions resolve against it, and one that leaves it,
 * through `..`, an absolute path or a link, is refused. `room` is how many
 * more files the message can hold.
 */
export function prepareCommand(call: CommandCall, input: { cwd?: string; room: number }): PreparedCommand {
  const expanded = expandCommandTemplate(call.entry.command, call.args, {
    projectDir: input.cwd ?? "",
    positionalBase: call.entry.source === "codex" ? 1 : 0,
  });
  const problems: string[] = [];
  const attachments = input.cwd ? mentionAttachments(expanded.mentions, input.cwd, input.room, problems) : [];
  return { call, text: expanded.text, shell: expanded.shell, attachments, problems };
}

function mentionAttachments(mentions: readonly string[], cwd: string, room: number, problems: string[]): MessageAttachment[] {
  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    return [];
  }
  const files: MessageAttachment[] = [];
  for (const mention of mentions) {
    let real: string;
    try {
      real = realpathSync(path.resolve(cwd, mention));
    } catch {
      continue; // Not a path here; it stays as text.
    }
    const relative = path.relative(root, real);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      problems.push(`@${mention} is outside this conversation's folder, so it was not attached.`);
      continue;
    }
    if (!statSync(real).isFile() || files.some((file) => file.path === real)) continue;
    if (files.length >= room) {
      problems.push(`@${mention} was not attached: a message holds at most ${MAX_MESSAGE_ATTACHMENTS} files.`);
      continue;
    }
    try {
      files.push(...validateMessageAttachments([{ name: path.basename(real), path: real }]));
    } catch (error) {
      problems.push(`@${mention} was not attached: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return files;
}

export interface CommandShellContext {
  /** Where spans run. Without one, they do not. */
  cwd?: string;
  trusted: boolean;
  record: (run: CustomizationRunRecord) => void;
}

/** Run each shell span once, in order, and put its output where its token stands. */
export async function runCommandShell(prepared: PreparedCommand, context: CommandShellContext): Promise<{ text: string; problems: string[] }> {
  const { entry } = prepared.call;
  const label = `/${entry.command.name}`;
  if (prepared.shell.length === 0) return { text: prepared.text, problems: [] };
  const blocked = shellBlocked(entry, context.trusted) ? UNTRUSTED_SHELL : !context.cwd ? "(not run: this conversation has no folder)" : undefined;
  if (blocked) {
    const outputs = new Map(prepared.shell.map((span) => [span.token, blocked]));
    const problem = blocked === UNTRUSTED_SHELL ? `${label}'s shell commands wait until you trust this project.` : `${label}'s shell commands need a folder to run in.`;
    return { text: spliceShellOutputs(prepared.text, outputs), problems: [problem] };
  }
  const outputs = new Map<string, string>();
  const problems: string[] = [];
  for (const span of prepared.shell) {
    const startedAt = new Date().toISOString();
    let result: CappedRun | undefined;
    let failure: string | undefined;
    try {
      result = await runCapped(context.cwd!, span.command, { timeoutMs: COMMAND_SHELL_TIMEOUT_MS, maxBytes: COMMAND_SHELL_MAX_BYTES });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const outcome = result ? shellOutcome(result) : `could not run: ${failure}`;
    if (!result || result.code !== 0) problems.push(`${label}: ${span.command} ${outcome}.`);
    outputs.set(span.token, result ? shellText(result) : `(could not run: ${failure})`);
    context.record({
      id: createId("cmdrun"),
      kind: "command-shell",
      label,
      command: span.command,
      source: entry.path,
      startedAt,
      durationMs: result?.durationMs ?? 0,
      exitCode: result?.code ?? null,
      ...(result && result.code !== 0 && result.output ? { stderr: result.output.slice(-2048) } : {}),
      outcome,
    });
  }
  return { text: spliceShellOutputs(prepared.text, outputs), problems };
}

function shellOutcome(result: CappedRun): string {
  if (result.timedOut) return `stopped after ${COMMAND_SHELL_TIMEOUT_MS / 1000} s`;
  return result.code === 0 ? "ok" : `exit ${result.code}`;
}

function shellText(result: CappedRun): string {
  const notes: string[] = [];
  if (result.truncated) notes.push(`(output cut at ${COMMAND_SHELL_MAX_BYTES / 1024} KB)`);
  if (result.timedOut || result.code !== 0) notes.push(`(${shellOutcome(result)})`);
  return [result.output.replace(/\n+$/, ""), ...notes].filter(Boolean).join("\n");
}

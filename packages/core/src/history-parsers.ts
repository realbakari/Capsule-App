import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ImportAgentId } from "@capsule/shared";

/** One prompt and the reply that ended its turn. */
export interface HistoryTurn {
  prompt: string;
  reply?: string;
  at: string;
}

/** An agent's session file, read into what Capsule keeps of it. */
export interface ParsedHistory {
  nativeSessionId: string;
  cwd: string;
  title?: string;
  turns: HistoryTurn[];
  lastActivity: string;
  /** Lines that were not JSON or not a shape this parser knows. */
  skipped: number;
}

/**
 * Where an agent keeps its sessions and how to read one. Each source only
 * reads: these files belong to the agent, and Capsule never writes them.
 */
export interface HistorySource {
  agent: ImportAgentId;
  /** The folder that holds the agent's sessions, whether or not it exists. */
  root(env: NodeJS.ProcessEnv): string;
  /** Session files under `root` that may belong to `cwd`, newest first. */
  files(root: string, cwd: string): Promise<string[]>;
  parse(lines: readonly string[], file: string): ParsedHistory | undefined;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseLine(raw: string): Json | undefined {
  if (!raw.trim()) return undefined;
  try { return record(JSON.parse(raw)); } catch { return undefined; }
}

/** Text blocks of a message body, or undefined when it carries anything else (tool results). */
function textBlocks(content: unknown, kinds: readonly string[]): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const item = record(block);
    const kind = text(item?.type);
    if (!kind || !kinds.includes(kind)) {
      if (kind === "tool_result" || kind === "tool_use") return undefined;
      continue;
    }
    const value = text(item?.text);
    if (value) parts.push(value);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Wrappers an agent writes into the user's side of the log that the user never typed. */
const INJECTED = /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|environment_context|user_instructions|user_shell_command|turn_aborted)\b/u;

function typedPrompt(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || INJECTED.test(trimmed) || trimmed.startsWith("Caveat: The messages below")) return undefined;
  return trimmed;
}

class TurnCollector {
  readonly turns: HistoryTurn[] = [];
  lastActivity = "";

  stamp(at: string | undefined): void {
    if (at && at > this.lastActivity) this.lastActivity = at;
  }

  prompt(value: string, at: string | undefined): void {
    this.turns.push({ prompt: value, at: at ?? this.lastActivity });
  }

  /** The newest reply in a turn is its final one. */
  reply(value: string | undefined): void {
    const trimmed = value?.trim();
    const turn = this.turns.at(-1);
    if (trimmed && turn) turn.reply = trimmed;
  }
}

async function jsonlFiles(dir: string, match: (name: string) => boolean, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) found.push(...(await jsonlFiles(full, match, depth - 1)));
    else if (entry.isFile() && match(entry.name)) found.push(full);
  }
  return found;
}

async function newestFirst(files: string[], limit: number): Promise<string[]> {
  const stamped = await Promise.all(files.map(async (file) => ({ file, at: (await stat(file).catch(() => undefined))?.mtimeMs ?? 0 })));
  return stamped.sort((a, b) => b.at - a.at).slice(0, limit).map((item) => item.file);
}

async function firstLine(file: string): Promise<string | undefined> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) return line;
    return undefined;
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** The folder name Claude Code files a working directory's sessions under. */
export function claudeProjectSlug(cwd: string): string {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/gu, "-");
}

const FILE_LIMIT = 400;

export const claudeHistory: HistorySource = {
  agent: "claude",
  root: (env) => path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude"), "projects"),
  async files(root, cwd) {
    return newestFirst(await jsonlFiles(path.join(root, claudeProjectSlug(cwd)), (name) => name.endsWith(".jsonl"), 0), FILE_LIMIT);
  },
  parse(lines, file) {
    const collected = new TurnCollector();
    let id = "";
    let cwd = "";
    let title: string | undefined;
    let skipped = 0;
    for (const raw of lines) {
      const line = parseLine(raw);
      if (!line) { if (raw.trim()) skipped++; continue; }
      const type = text(line.type);
      if (type === "custom-title" || type === "summary") {
        title = text(line.customTitle) ?? text(line.summary) ?? title;
        continue;
      }
      if (type !== "user" && type !== "assistant") continue;
      if (line.isSidechain === true) continue;
      const message = record(line.message);
      if (!message) { skipped++; continue; }
      id ||= text(line.sessionId) ?? "";
      cwd ||= text(line.cwd) ?? "";
      const at = text(line.timestamp);
      collected.stamp(at);
      if (type === "user") {
        if (line.isMeta === true) continue;
        const prompt = typedPrompt(textBlocks(message.content, ["text"]));
        if (prompt) collected.prompt(prompt, at);
      } else {
        collected.reply(textBlocks(message.content, ["text"]));
      }
    }
    id ||= path.basename(file, ".jsonl");
    if (!cwd || collected.turns.length === 0) return undefined;
    return { nativeSessionId: id, cwd, title, turns: collected.turns, lastActivity: collected.lastActivity, skipped };
  },
};

export const codexHistory: HistorySource = {
  agent: "codex",
  root: (env) => path.join(env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex"), "sessions"),
  async files(root, cwd) {
    const want = path.resolve(cwd);
    const all = await newestFirst(await jsonlFiles(root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"), 4), FILE_LIMIT);
    const matching: string[] = [];
    for (const file of all) {
      const meta = record(parseLine((await firstLine(file).catch(() => undefined)) ?? "")?.payload);
      if (text(meta?.cwd) === want) matching.push(file);
    }
    return matching;
  },
  parse(lines) {
    const collected = new TurnCollector();
    const items = new TurnCollector();
    let id = "";
    let cwd = "";
    let skipped = 0;
    for (const raw of lines) {
      const line = parseLine(raw);
      if (!line) { if (raw.trim()) skipped++; continue; }
      const payload = record(line.payload);
      const at = text(line.timestamp);
      collected.stamp(at);
      items.stamp(at);
      if (line.type === "session_meta") {
        id ||= text(payload?.id) ?? "";
        cwd ||= text(payload?.cwd) ?? "";
      } else if (line.type === "turn_context") {
        cwd ||= text(payload?.cwd) ?? "";
      } else if (line.type === "event_msg") {
        if (payload?.type === "user_message") {
          const prompt = typedPrompt(text(payload.message));
          if (prompt) collected.prompt(prompt, at);
        } else if (payload?.type === "agent_message") collected.reply(text(payload.message));
      } else if (line.type === "response_item" && payload?.type === "message") {
        if (payload.role === "user") {
          const prompt = typedPrompt(textBlocks(payload.content, ["input_text"]));
          if (prompt) items.prompt(prompt, at);
        } else if (payload.role === "assistant") items.reply(textBlocks(payload.content, ["output_text"]));
      } else if (!line.type && !payload) skipped++;
    }
    /* Event messages are what the user typed and read; response items are the fallback for logs that predate them. */
    const turns = collected.turns.length ? collected : items;
    if (!id || !cwd || turns.turns.length === 0) return undefined;
    return { nativeSessionId: id, cwd, turns: turns.turns, lastActivity: turns.lastActivity, skipped };
  },
};

/** Every agent with a documented, local session history. Others are not importable. */
export const HISTORY_SOURCES: Record<ImportAgentId, HistorySource> = {
  claude: claudeHistory,
  codex: codexHistory,
};

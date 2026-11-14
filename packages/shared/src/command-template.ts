import { AGENT_MODES } from "./runtime.js";
import type { AgentMode } from "./types.js";

/** A custom command: a Markdown file whose body becomes the prompt. */
export interface CommandTemplate {
  /** `review`, or `git:commit` for `git/commit.md`. */
  name: string;
  description?: string;
  argumentHint?: string;
  /** Names for positional arguments, so the body can say `$file` instead of `$0`. */
  argumentNames: string[];
  profile?: string;
  mode?: AgentMode;
  workspace?: "local" | "worktree";
  /** `review` puts the expansion in the composer instead of sending it. */
  send: "auto" | "review";
  body: string;
}

export interface ParsedCommandFile {
  /** Absent when the name is invalid; the file cannot be invoked. */
  command?: CommandTemplate;
  problems: string[];
}

const NAME = /^[a-z0-9][a-z0-9:_-]*$/;
const ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `git/commit.md` becomes `git:commit`. */
export function commandNameFromPath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .join(":");
}

export function isValidCommandName(name: string): boolean {
  return NAME.test(name);
}

type FrontmatterValue = string | string[];

/**
 * `ignoreUnknownKeys` is for another tool's command files, whose own keys
 * (allowed tools, a model) mean nothing to Capsule and are not mistakes.
 */
export function parseCommandFile(name: string, text: string, options: { ignoreUnknownKeys?: boolean } = {}): ParsedCommandFile {
  const problems: string[] = [];
  if (!NAME.test(name)) {
    problems.push(`"${name}" is not a valid command name. Use lowercase letters, digits, "-", "_" and ":" for folders.`);
  }
  const { fields, body } = splitFrontmatter(text.replace(/^\uFEFF/, ""), problems);

  const command: CommandTemplate = { name, argumentNames: [], send: "auto", body };
  for (const [key, { value, line }] of fields) {
    const where = `line ${line}: ${key}`;
    const single = (): string | undefined => {
      if (typeof value === "string") return value;
      problems.push(`${where} must be a single value.`);
      return undefined;
    };
    switch (key) {
      case "description":
        command.description = single();
        break;
      case "argument-hint":
        command.argumentHint = single();
        break;
      case "profile":
        command.profile = single();
        break;
      case "mode": {
        const v = single();
        const mode = AGENT_MODES.find((item) => item === v);
        if (mode) command.mode = mode;
        else if (v !== undefined) problems.push(`${where} must be one of ${AGENT_MODES.join(", ")}.`);
        break;
      }
      case "workspace": {
        const v = single();
        if (v === "local" || v === "worktree") command.workspace = v;
        else if (v !== undefined) problems.push(`${where} must be local or worktree.`);
        break;
      }
      case "send": {
        const v = single();
        if (v === "auto" || v === "review") command.send = v;
        else if (v !== undefined) problems.push(`${where} must be auto or review.`);
        break;
      }
      case "arguments": {
        const names = typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : value;
        for (const argument of names) {
          if (!ARGUMENT_NAME.test(argument) || argument === "ARGUMENTS") {
            problems.push(`${where}: "${argument}" is not a usable argument name.`);
          } else if (!command.argumentNames.includes(argument)) {
            command.argumentNames.push(argument);
          }
        }
        break;
      }
      default:
        if (!options.ignoreUnknownKeys) problems.push(`line ${line}: unknown key "${key}" is ignored.`);
    }
  }
  if (!NAME.test(name)) return { problems };
  const defined = Object.entries(command).filter(([, value]) => value !== undefined);
  return { command: Object.fromEntries(defined) as unknown as CommandTemplate, problems };
}

export function splitFrontmatter(
  text: string,
  problems: string[],
): { fields: Map<string, { value: FrontmatterValue; line: number }>; body: string } {
  const fields = new Map<string, { value: FrontmatterValue; line: number }>();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fields, body: text.trim() };
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close === -1) {
    problems.push("line 1: the frontmatter block is never closed with ---, so it is read as part of the body.");
    return { fields, body: text.trim() };
  }

  let listKey: { key: string; line: number } | undefined;
  for (let i = 1; i < close; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const item = /^-\s+(.*)$/.exec(trimmed) ?? (trimmed === "-" ? ["-", ""] : null);
    if (item) {
      if (!listKey) {
        problems.push(`line ${lineNo}: a list item with no key above it is ignored.`);
        continue;
      }
      const entry = fields.get(listKey.key)!;
      (entry.value as string[]).push(unquote(item[1]!.trim()));
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      problems.push(`line ${lineNo}: expected "key: value".`);
      listKey = undefined;
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    if (fields.has(key)) problems.push(`line ${lineNo}: ${key} is set twice; the later value wins.`);
    if (!rawValue) {
      fields.set(key, { value: [], line: lineNo });
      listKey = { key, line: lineNo };
      continue;
    }
    listKey = undefined;
    fields.set(key, { value: parseScalarOrList(rawValue), line: lineNo });
  }
  return { fields, body: lines.slice(close + 1).join("\n").trim() };
}

function parseScalarOrList(value: string): FrontmatterValue {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => unquote(v.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\n])/g, (_, ch: string) => (ch === "n" ? "\n" : ch));
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** Split arguments the way a shell would: whitespace separates, quotes group, backslash escapes. */
export function splitArguments(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "\\" && i + 1 < text.length && '"\\$`'.includes(text[i + 1]!)) current += text[++i];
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < text.length) {
      current += text[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

/** One `` !`cmd` `` span: run `command`, then splice its output where `token` stands. */
export interface ShellSpan {
  token: string;
  command: string;
}

export interface ExpandedCommand {
  text: string;
  shell: ShellSpan[];
  /** `@path` mentions, in order, each once. They stay in the text. */
  mentions: string[];
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const SHELL_SPAN = /(!`[^`]*`)/;

/** The commands a body's `` !`cmd` `` spans run, before any argument is put in. */
export function shellSpanCommands(body: string): string[] {
  return body.split(SHELL_SPAN).filter((_, i) => i % 2 === 1).map((span) => span.slice(2, -1));
}

const PLACEHOLDER = /\$\{CAPSULE_PROJECT_DIR\}|\$ARGUMENTS\b|\$(\d)|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Arguments can come from a paired phone, so they are substituted only after
 * the body's shell spans are cut out: an argument can never open a span, and
 * inside a span every substituted value is single-quoted.
 */
export function expandCommandTemplate(
  command: CommandTemplate,
  argsText: string,
  /** `positionalBase: 1` makes `$1` the first argument, as other tools' prompt files expect. */
  options: { projectDir: string; positionalBase?: 0 | 1 },
): ExpandedCommand {
  const raw = argsText.trim();
  const args = splitArguments(raw);
  let used = false;

  const substitute = (text: string, quoted: boolean): string =>
    text.replace(PLACEHOLDER, (match, digit: string | undefined, name: string | undefined) => {
      const wrap = (value: string) => (quoted ? shellQuote(value) : value);
      if (match === "${CAPSULE_PROJECT_DIR}") return wrap(options.projectDir);
      if (match === "$ARGUMENTS") {
        used = true;
        return quoted ? args.map(shellQuote).join(" ") : raw;
      }
      if (digit !== undefined) {
        used = true;
        return wrap(args[Number(digit) - (options.positionalBase ?? 0)] ?? "");
      }
      const index = name === undefined ? -1 : command.argumentNames.indexOf(name);
      if (index === -1) return match;
      used = true;
      return wrap(args[index] ?? "");
    });

  const marker = uniqueMarker(command.body + raw);
  const shell: ShellSpan[] = [];
  const parts = command.body.split(SHELL_SPAN);
  let text = parts
    .map((part, i) => {
      if (i % 2 === 0) return substitute(part, false);
      const token = `${marker}${shell.length}\u27E7`;
      shell.push({ token, command: substitute(part.slice(2, -1), true) });
      return token;
    })
    .join("");

  if (!used && raw) text += `\n\nARGUMENTS: ${raw}`;
  return { text, shell, mentions: collectMentions(text) };
}

function uniqueMarker(haystack: string): string {
  let marker = "\u27E6shell-";
  while (haystack.includes(marker)) marker += "#";
  return marker;
}

const MENTION = /(^|[\s([{"'])@([A-Za-z0-9._~/-]*[A-Za-z0-9_~/-])/g;

function collectMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const path = match[2]!;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** Put each shell span's output where its token stands, without its trailing newlines. */
export function spliceShellOutputs(text: string, outputs: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [token, output] of outputs) out = out.split(token).join(output.replace(/\n+$/, ""));
  return out;
}

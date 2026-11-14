export const PERMISSION_KINDS = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "other",
  "mcp",
] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export type PermissionList = "allow" | "ask" | "deny";

/** What a rule's specifier selects, once parsed. */
export type PermissionTarget =
  | { type: "any" }
  | { type: "command"; pattern: string }
  | { type: "path"; pattern: string }
  | { type: "domain"; host: string; subdomains: boolean }
  | { type: "url"; pattern: string }
  | { type: "mcp"; server: string; tool: string }
  | { type: "title"; pattern: string };

export interface PermissionRule {
  /** Canonical text, `kind` or `kind(specifier)`. */
  text: string;
  kind: PermissionKind;
  target: PermissionTarget;
}

/** One permission request an agent sent, in Capsule's terms. */
export interface PermissionSubject {
  kind: PermissionKind;
  title: string;
  command?: string;
  paths: string[];
  url?: string;
  mcp?: { server: string; tool: string };
}

export interface PermissionContext {
  root: string;
  home: string;
  /**
   * Match deny and ask path rules without regard to case, for a file system
   * that ignores it. Allow rules stay exact, so `.ENV` cannot slip past
   * `deny edit(.env)` and `Src/` is not allowed by `allow edit(src/**)`.
   */
  caseInsensitivePaths?: boolean;
}

export interface SourcedPermissionRule {
  list: PermissionList;
  rule: string;
  /** The file the rule came from. */
  source: string;
}

export interface PermissionDecision {
  decision: PermissionList | "none";
  rule?: string;
  source?: string;
}

export type ParsedPermissionRule = { ok: true; rule: PermissionRule } | { ok: false; message: string };

const PATH_KINDS = new Set<PermissionKind>(["read", "edit", "delete", "move", "search"]);

export function parsePermissionRule(text: string): ParsedPermissionRule {
  const trimmed = text.trim();
  const open = trimmed.indexOf("(");
  const rawKind = (open === -1 ? trimmed : trimmed.slice(0, open)).trim().toLowerCase();
  if (!rawKind) return { ok: false, message: "A rule needs a kind, such as execute or edit." };
  if (!(PERMISSION_KINDS as readonly string[]).includes(rawKind)) {
    return { ok: false, message: `Unknown kind "${rawKind}". Use one of ${PERMISSION_KINDS.join(", ")}.` };
  }
  const kind = rawKind as PermissionKind;
  if (open === -1) return { ok: true, rule: { text: kind, kind, target: { type: "any" } } };
  if (!trimmed.endsWith(")")) return { ok: false, message: `"${trimmed}" is missing its closing parenthesis.` };
  const written = trimmed.slice(open + 1, -1).trim();
  const specifier = kind === "execute" ? collapseSpaces(written) : written;
  if (!specifier) return { ok: false, message: `"${trimmed}" has an empty specifier. Write the bare kind to match everything.` };
  const target = parseTarget(kind, specifier);
  if (typeof target === "string") return { ok: false, message: target };
  return { ok: true, rule: { text: `${kind}(${specifier})`, kind, target } };
}

function parseTarget(kind: PermissionKind, specifier: string): PermissionTarget | string {
  if (kind === "execute") return { type: "command", pattern: specifier };
  if (PATH_KINDS.has(kind)) return { type: "path", pattern: specifier };
  if (kind === "fetch") {
    if (!specifier.startsWith("domain:")) return { type: "url", pattern: specifier };
    const host = specifier.slice("domain:".length).trim().toLowerCase();
    const subdomains = host.startsWith("*.");
    const bare = subdomains ? host.slice(2) : host;
    if (!bare || /[\s/*:]/.test(bare)) return `"${specifier}" is not a host. Write domain:example.com or domain:*.example.com.`;
    return { type: "domain", host: bare, subdomains };
  }
  if (kind === "mcp") {
    const colon = specifier.indexOf(":");
    const server = (colon === -1 ? specifier : specifier.slice(0, colon)).trim();
    const tool = colon === -1 ? "*" : specifier.slice(colon + 1).trim();
    if (!server || !tool) return `"${specifier}" needs a server and a tool, such as browser:navigate or browser:*.`;
    return { type: "mcp", server, tool };
  }
  return { type: "title", pattern: specifier };
}

/**
 * Deny beats ask beats allow. Within a list the first matching rule, in the
 * order given, is the one cited. Malformed rules are skipped.
 */
export function decidePermission(
  rules: readonly SourcedPermissionRule[],
  subject: PermissionSubject,
  context: PermissionContext,
): PermissionDecision {
  const parsed = rules.flatMap((entry) => {
    const result = parsePermissionRule(entry.rule);
    return result.ok ? [{ entry, rule: result.rule }] : [];
  });
  for (const list of ["deny", "ask", "allow"] as const) {
    const mode = list === "allow" ? "all" : "any";
    const hit = parsed.find(({ entry, rule }) => entry.list === list && ruleMatches(rule, subject, context, mode));
    if (hit) return { decision: list, rule: hit.rule.text, source: hit.entry.source };
  }
  return { decision: "none" };
}

const VERBS: Record<PermissionList, string> = { allow: "Allowed", ask: "Asked", deny: "Denied" };

export function describeDecision(decision: PermissionDecision, home?: string): string {
  if (decision.decision === "none" || !decision.rule) return "No permission rule matched";
  const source = decision.source ? ` in ${tildify(decision.source, home)}` : "";
  return `${VERBS[decision.decision]} by ${decision.rule}${source}`;
}

function tildify(path: string, home: string | undefined): string {
  if (!home) return path;
  const base = home.replace(/\/+$/, "");
  if (path === base) return "~";
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/**
 * `any` is how deny and ask read a request: one matching path or command
 * segment is enough. `all` is how allow reads it: every one must match, and
 * there must be at least one.
 */
function ruleMatches(rule: PermissionRule, subject: PermissionSubject, context: PermissionContext, mode: "all" | "any"): boolean {
  if (rule.kind !== subject.kind) return false;
  const target = rule.target;
  switch (target.type) {
    case "any":
      return true;
    case "command": {
      if (subject.command === undefined) return false;
      const pattern = commandPattern(target.pattern);
      const split = splitCommand(subject.command);
      if (mode === "all") return !split.opaque && split.segments.length > 0 && split.segments.every((s) => pattern.test(s));
      return [collapseSpaces(subject.command), ...split.segments].some((s) => pattern.test(s));
    }
    case "path": {
      const pattern = pathPattern(target.pattern, context, mode === "any" && context.caseInsensitivePaths === true);
      return matchList(subject.paths.map((p) => resolvePath(p, context)), (p) => pattern.test(p), mode);
    }
    case "domain": {
      const host = hostOf(subject.url);
      if (host === undefined) return false;
      return target.subdomains ? host.endsWith(`.${target.host}`) : host === target.host;
    }
    case "url":
      return subject.url !== undefined && wildcardPattern(target.pattern).test(subject.url);
    case "mcp":
      return (
        subject.mcp !== undefined &&
        wildcardPattern(target.server).test(subject.mcp.server) &&
        wildcardPattern(target.tool).test(subject.mcp.tool)
      );
    case "title":
      return wildcardPattern(target.pattern).test(subject.title);
  }
}

function matchList(values: string[], test: (value: string) => boolean, mode: "all" | "any"): boolean {
  if (values.length === 0) return false;
  return mode === "all" ? values.every(test) : values.some(test);
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function wildcardPattern(glob: string): RegExp {
  return new RegExp(`^${glob.split("*").map(escapeRegex).join(".*")}$`);
}

/** A trailing ` *` also matches the bare command, so `pnpm test *` covers `pnpm test`. */
function commandPattern(glob: string): RegExp {
  const optionalTail = glob.endsWith(" *");
  const body = optionalTail ? glob.slice(0, -2) : glob;
  const source = body.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${source}${optionalTail ? "(?: .*)?" : ""}$`);
}

function collapseSpaces(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

interface SplitCommand {
  /** Simple commands, split at unquoted `;`, `&`, `|`, `&&`, `||` and newlines, with `$(…)` and backtick bodies added. */
  segments: string[];
  /** True when a segment substitutes a command or redirects to a file, which an allow rule's `*` must never cover. */
  opaque: boolean;
}

const HARMLESS_REDIRECT = /\d*>&\d+|\d*>\s*\/dev\/null|<\s*\/dev\/null/g;

function splitCommand(command: string): SplitCommand {
  const segments: string[] = [];
  let opaque = false;
  let current = "";
  let quote: "'" | '"' | undefined;
  const flush = () => {
    const segment = collapseSpaces(current);
    current = "";
    if (!segment) return;
    if (/[<>]/.test(unquoted(segment).replace(HARMLESS_REDIRECT, ""))) opaque = true;
    segments.push(segment);
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = undefined;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[i + 1];
      i++;
      continue;
    }
    if (ch === "`" || (ch === "$" && command[i + 1] === "(") || ((ch === "<" || ch === ">") && command[i + 1] === "(")) {
      const start = ch === "`" ? i + 1 : i + 2;
      const end = ch === "`" ? command.indexOf("`", start) : matchingParen(command, start);
      const inner = command.slice(start, end === -1 ? command.length : end);
      const nested = splitCommand(inner);
      segments.push(...nested.segments);
      opaque = true;
      current += command.slice(i, end === -1 ? command.length : end + 1);
      i = end === -1 ? command.length : end;
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '"') quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || (ch === "&" && command[i - 1] !== ">" && command[i + 1] !== ">")) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return { segments, opaque };
}

function matchingParen(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function unquoted(segment: string): string {
  return segment.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "");
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home.replace(/\/+$/, "")}${path.slice(1)}` : path;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

/** Lexical resolution: `..` is applied before matching, so `src/../../x` cannot hide outside the root. */
function resolvePath(path: string, context: PermissionContext): string {
  const expanded = expandHome(path.replace(/\\/g, "/"), context.home);
  const joined = isAbsolute(expanded) ? expanded : `${context.root}/${expanded}`;
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? "";
  const parts: string[] = [];
  for (const part of joined.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join("/")}`;
}

function pathPattern(glob: string, context: PermissionContext, ignoreCase: boolean): RegExp {
  const resolved = resolvePath(glob, context);
  let source = "";
  const segments = resolved.split("/");
  segments.forEach((segment, index) => {
    if (index === 0) {
      source += escapeRegex(segment);
      return;
    }
    if (segment === "**") {
      source += index === segments.length - 1 ? "(?:/.*)?" : "(?:/[^/]+)*";
      return;
    }
    source += "/";
    for (const ch of segment) {
      if (ch === "*") source += "[^/]*";
      else if (ch === "?") source += "[^/]";
      else source += escapeRegex(ch);
    }
  });
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

/** What an ACP tool call carries that a rule can read. */
export interface PermissionToolCall {
  kind?: string;
  title?: string;
  rawInput?: unknown;
  locations?: readonly string[];
}

const MCP_TOOL = /^mcp__(.+?)__(.+)$/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "fish", "ksh"]);
const PATH_FIELDS = ["path", "file_path", "filePath", "notebook_path", "abs_path"];
/** Longer than this, a command is not matched at all, so a clipped copy can never be what an allow rule saw. */
const MAX_COMMAND_LENGTH = 4096;

/**
 * The request in rule terms. Agents describe a tool call differently; this
 * reads the ACP `kind`, the command from `rawInput.command` (a string or an
 * argv array) or the title, paths from `locations` and the usual `rawInput`
 * path fields, the URL from `rawInput.url`, and an MCP tool from a
 * `mcp__server__tool` title.
 */
export function permissionSubject(call: PermissionToolCall): PermissionSubject {
  const title = (call.title ?? "").trim().slice(0, MAX_COMMAND_LENGTH + 1);
  const input = call.rawInput && typeof call.rawInput === "object" && !Array.isArray(call.rawInput)
    ? call.rawInput as Record<string, unknown>
    : {};
  const mcp = MCP_TOOL.exec(title);
  const written = (call.kind ?? "").toLowerCase();
  const kind: PermissionKind = mcp ? "mcp" : written !== "mcp" && (PERMISSION_KINDS as readonly string[]).includes(written) ? written as PermissionKind : "other";
  const paths = new Set<string>();
  const addPath = (value: unknown) => { if (typeof value === "string" && value && value.length <= MAX_COMMAND_LENGTH) paths.add(value); };
  for (const location of call.locations ?? []) addPath(location);
  for (const field of PATH_FIELDS) addPath(input[field]);
  if (Array.isArray(input.paths)) for (const item of input.paths.slice(0, 64)) addPath(item);
  const command = kind === "execute" ? commandOf(input, title) : undefined;
  const url = typeof input.url === "string" && input.url.length <= MAX_COMMAND_LENGTH ? input.url : undefined;
  return {
    kind,
    title,
    ...(command !== undefined ? { command } : {}),
    paths: [...paths],
    ...(url ? { url } : {}),
    ...(mcp ? { mcp: { server: mcp[1]!, tool: mcp[2]! } } : {}),
  };
}

function commandOf(input: Record<string, unknown>, title: string): string | undefined {
  const raw = input.command ?? input.cmd;
  const text = typeof raw === "string"
    ? raw
    : Array.isArray(raw) && raw.length > 0 && raw.every((item) => typeof item === "string")
      ? argvCommand(raw as string[])
      : title.replace(/^`+|`+$/g, "");
  const command = text.trim();
  return command && command.length <= MAX_COMMAND_LENGTH ? command : undefined;
}

/** `["bash", "-lc", "pnpm test"]` is the script; any other argv is its words. */
function argvCommand(argv: string[]): string {
  const [file, flag, script] = argv;
  const shell = file?.split("/").pop() ?? "";
  if (argv.length === 3 && SHELLS.has(shell) && flag && /^-l?c$/.test(flag) && script !== undefined) return script;
  return argv.map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`)).join(" ");
}

/**
 * The allow rule an "always allow" choice writes for a request: a command's
 * first two words and ` *`, a single exact path, a host, or an MCP tool.
 * Undefined when no rule would say what the person approved.
 */
export function suggestAllowRule(subject: PermissionSubject): string | undefined {
  let rule: string | undefined;
  if (subject.kind === "execute" && subject.command) {
    const words = collapseSpaces(subject.command).split(" ").slice(0, 2);
    if (!words.some((word) => /[*()]/.test(word))) rule = `execute(${words.join(" ")} *)`;
  } else if (PATH_KINDS.has(subject.kind) && subject.paths.length === 1) {
    const only = subject.paths[0]!;
    if (!/[*?()]/.test(only)) rule = `${subject.kind}(${only})`;
  } else if (subject.kind === "fetch") {
    const host = hostOf(subject.url);
    if (host) rule = `fetch(domain:${host})`;
  } else if (subject.kind === "mcp" && subject.mcp) {
    rule = `mcp(${subject.mcp.server}:${subject.mcp.tool})`;
  }
  if (!rule) return undefined;
  const parsed = parsePermissionRule(rule);
  return parsed.ok ? parsed.rule.text : undefined;
}

/** Whether an absolute folder matches a path glob such as `~/work/**`. Case-sensitive. */
export function folderMatchesGlob(folder: string, glob: string, home: string): boolean {
  const context: PermissionContext = { root: "/", home };
  return pathPattern(glob, context, false).test(resolvePath(folder, context));
}

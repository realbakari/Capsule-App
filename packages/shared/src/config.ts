import type { CapsuleSettings } from "./runtime.js";

/**
 * The layers a value can come from, highest precedence first after the
 * thread's own choice. `default` is the built-in value. `legacy` is a key the
 * project's `capsule.json` sets (only `defaultWorkspaceMode`).
 */
export type ConfigScope = "local" | "project" | "legacy" | "user" | "default";

/** The layers a person can write to from the Settings UI. */
export type WritableScope = "user" | "project" | "local";

export const WRITABLE_SCOPES: readonly WritableScope[] = ["user", "project", "local"];

/** Where an effective value came from. */
export interface Provenance {
  scope: ConfigScope;
  /** Absolute path of the file that set it. Absent for defaults. */
  path?: string;
}

/** A file Capsule read, in the doctor's terms. */
export type SourceState =
  /** Parsed and applied. */
  | "ok"
  /** The file does not exist. Not a problem. */
  | "missing"
  /** It does not parse. The last good copy, if any, is in use. */
  | "broken"
  /** A project file whose executable entries wait for the folder to be trusted. */
  | "untrusted"
  /** Safe mode: the file was not read. */
  | "skipped";

export type SourceKind =
  | "settings"
  | "keybindings"
  | "command"
  | "profile"
  | "style"
  | "theme"
  | "plugin";

export interface ConfigSourceReport {
  kind: SourceKind;
  scope: ConfigScope;
  path: string;
  state: SourceState;
  /** Top-level keys this file set, for settings files. */
  keys?: string[];
  /** Parser message with a 1-based line and column, when broken. */
  error?: { message: string; line: number; column: number };
  /** True when a broken file is being served from its last good copy. */
  usingLastGood?: boolean;
}

export type ConfigProblemSeverity = "error" | "warning";

/** One entry that was skipped, with why. The rest of its file still applies. */
export interface ConfigProblem {
  severity: ConfigProblemSeverity;
  path: string;
  /** JSON path or file-relative locator, such as `hooks.TurnEnd[0]`. */
  key?: string;
  message: string;
}

/** Something a project file wants to run, held until the folder is trusted. */
export interface PendingTrustItem {
  kind: "hook" | "command-shell" | "mcp-server" | "automation" | "permission-allow" | "status-line";
  /** What would run, in words a person can judge: a command line or a URL. */
  detail: string;
  path: string;
}

export interface ProjectTrust {
  root: string;
  trusted: boolean;
  trustedAt?: string;
  pending: PendingTrustItem[];
}

/** A run of a hook or status line command, for the doctor. */
export interface CustomizationRunRecord {
  id: string;
  kind: "hook" | "status-line" | "command-shell" | "automation";
  /** Hook event name, status line, or command name. */
  label: string;
  command: string;
  source: string;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  /** Trimmed to the last 2 KB. */
  stderr?: string;
  outcome?: string;
}

export interface ConfigDiagnostics {
  safeMode: boolean;
  userDir: string;
  sources: ConfigSourceReport[];
  problems: ConfigProblem[];
  trust?: ProjectTrust;
  runs: CustomizationRunRecord[];
}

/** Settings keys a file may hold. Secrets never appear in a file. */
export type FileSettingKey = Exclude<keyof CapsuleSettings, "gatewayToken" | "skillsShToken">;

/** The effective configuration the renderer receives. It never reads a file. */
export interface ConfigSnapshot {
  safeMode: boolean;
  userDir: string;
  /** Effective user-level settings, what `getSettings` returns. */
  settings: CapsuleSettings;
  /** Provenance of every key a file set. Keys absent here are defaults. */
  provenance: Partial<Record<string, Provenance>>;
  project?: ProjectConfigSnapshot;
  /** Count of problems, for the doctor badge. */
  problemCount: number;
}

export interface ProjectConfigSnapshot {
  projectId: string;
  root: string;
  trusted: boolean;
  /** Settings with the project layers applied on top of the user's. */
  settings: CapsuleSettings;
  provenance: Partial<Record<string, Provenance>>;
  /** Files that exist, so the UI can offer "Open" instead of "Create". */
  files: { project: boolean; local: boolean };
}

export interface SetConfigValueInput {
  key: string;
  /** `undefined` removes the key from that layer (Reset). */
  value?: unknown;
  scope: WritableScope;
  projectId?: string;
}

export type ConfigFileTarget =
  | { kind: "settings"; scope: WritableScope; projectId?: string }
  | { kind: "keybindings" }
  | { kind: "folder"; folder: "commands" | "profiles" | "styles" | "themes" | "plugins"; scope: "user" | "project"; projectId?: string };

/**
 * Schema URLs written into new files for editor completion. They point at the
 * schemas committed in the repository, generated from the registries.
 */
const SCHEMA_BASE = "https://raw.githubusercontent.com/realbakari/Capsule-App/main/schemas";
export const SETTINGS_SCHEMA_URL = `${SCHEMA_BASE}/settings.schema.json`;
export const KEYBINDINGS_SCHEMA_URL = `${SCHEMA_BASE}/keybindings.schema.json`;
export const THEME_SCHEMA_URL = `${SCHEMA_BASE}/theme.schema.json`;

/* ── Extended keys: what a settings file can hold beyond CapsuleSettings ── */

/** Events Capsule raises for hooks. Only the first two can block. */
export type HookEvent = "PromptSubmit" | "PermissionRequest" | "ToolCall" | "TurnEnd";

export const HOOK_EVENTS: readonly HookEvent[] = ["PromptSubmit", "PermissionRequest", "ToolCall", "TurnEnd"];

export type HookHandler =
  | { type: "command"; command: string; timeout?: number }
  | { type: "http"; url: string; headers?: Record<string, string>; timeout?: number };

/** The widely known hook shape: a matcher group and its handlers. */
export interface HookMatcherGroup {
  /** Tool kind or title for ToolCall and PermissionRequest; `|` lists or a regex. Absent matches all. */
  matcher?: string;
  hooks: HookHandler[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcherGroup[]>>;

/**
 * Permission rules over the requests Capsule answers. A rule is
 * `kind(specifier)` or a bare kind, for example `execute(pnpm test *)`,
 * `edit(**\/.env*)`, `fetch(domain:github.com)`, `mcp(capsule-browser:*)`.
 */
export interface PermissionRules {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; enabled?: boolean; projects?: string[] }
  | { url: string; headers?: Record<string, string>; enabled?: boolean; projects?: string[] };

export type StatusLineItem = "branch" | "changes" | "context" | "limits" | "pr" | "model" | "harness" | "run" | "cost";

export const STATUS_LINE_ITEMS: readonly StatusLineItem[] = ["branch", "changes", "context", "limits", "pr", "model", "harness", "run", "cost"];

export interface StatusLineConfig {
  items?: StatusLineItem[];
  /** User scope only. Prints at most two lines; JSON context on stdin. */
  command?: string;
  /** Seconds between timed refreshes of the command, 1 or more. */
  refreshInterval?: number;
}

export interface ThemeSelection {
  mode?: "system" | "light" | "dark";
  /** Theme ids used for light and dark appearances. */
  light?: string;
  dark?: string;
}

export interface AutomationConfig {
  id: string;
  name: string;
  /** RFC 5545 recurrence, such as `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0`. */
  schedule: string;
  /** Exactly one of prompt or command. */
  prompt?: string;
  command?: string;
  profile?: string;
  workspace?: "local" | "worktree";
  enabled?: boolean;
}

/** Other tools' folders read as Markdown only, each opt-in. */
export type CommandSourceId = "claude-commands" | "claude-skills" | "codex-prompts";

export interface OpenWithHandler {
  id: string;
  label: string;
  command: string;
  args?: string[];
}

export interface ExtendedConfig {
  permissions?: PermissionRules;
  hooks?: HooksConfig;
  disableAllHooks?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
  statusLine?: StatusLineConfig;
  theme?: ThemeSelection;
  themeOverrides?: Record<string, Record<string, string>>;
  automations?: AutomationConfig[];
  commandSources?: Partial<Record<CommandSourceId, boolean>>;
  plugins?: Record<string, { enabled?: boolean }>;
  style?: string;
  personalInstructions?: string;
  openWith?: OpenWithHandler[];
}

export type ExtendedConfigKey = keyof ExtendedConfig;

/** One entry of a list or map that several files contribute to, and the file it came from. */
export interface Sourced<T> {
  value: T;
  source: Provenance;
}

/**
 * The extended keys after every layer is merged. Rule lists and hook groups
 * concatenate across files, MCP servers merge by name and automations by id,
 * so each of those entries keeps its own source.
 */
export interface EffectiveExtendedConfig {
  permissions: Record<keyof PermissionRules, Sourced<string>[]>;
  hooks: Partial<Record<HookEvent, Sourced<HookMatcherGroup>[]>>;
  disableAllHooks: boolean;
  mcpServers: Record<string, Sourced<McpServerConfig>>;
  automations: Sourced<AutomationConfig>[];
  statusLine?: StatusLineConfig;
  theme?: ThemeSelection;
  themeOverrides: Record<string, Record<string, string>>;
  commandSources: Partial<Record<CommandSourceId, boolean>>;
  plugins: Record<string, { enabled?: boolean }>;
  style?: string;
  personalInstructions?: string;
  openWith: OpenWithHandler[];
}

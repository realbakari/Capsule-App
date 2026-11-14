import { BUNDLED_THEMES } from "./theme.js";
import type { ThemeAppearance } from "./theme.js";
import { HARNESS_IDS } from "./harness.js";
import { compareVersions as compareParsed, parseVersion } from "./version.js";
import type { HookEvent, StatusLineItem } from "./config.js";

/**
 * Declarative plugins: a folder with `capsule-plugin.json` at its root that
 * contributes commands, profiles, styles, themes, skills, hooks, MCP servers
 * and a status line. Capsule reads every contribution as data; nothing in the
 * folder runs until the person has seen it listed and turned the plugin on.
 */
export const PLUGIN_MANIFEST_FILE = "capsule-plugin.json";

export const PLUGIN_OPTION_TYPES = ["string", "number", "boolean", "enum", "path", "secret"] as const;
export type PluginOptionType = (typeof PLUGIN_OPTION_TYPES)[number];
export type PluginOptionValue = string | number | boolean;

/** One typed option a plugin asks for. A `secret` is kept in the Keychain and only reaches environment variables. */
export interface PluginOption {
  key: string;
  type: PluginOptionType;
  title: string;
  description?: string;
  default?: PluginOptionValue;
  /** The choices of an `enum`. */
  options?: string[];
  required?: boolean;
}

/** Folders and files a plugin contributes, relative to its root. */
export const PLUGIN_FOLDER_KINDS = ["commands", "profiles", "styles", "themes", "skills"] as const;
export type PluginFolderKind = (typeof PLUGIN_FOLDER_KINDS)[number];

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: { name: string; url?: string };
  /** A version range of Capsule the plugin needs, such as `>=0.11`. */
  capsule?: string;
  /** Each folder is relative to the plugin root; a missing key means the conventional folder, if present. */
  folders: Partial<Record<PluginFolderKind, string>>;
  /** A path to a JSON file, relative to the root, or the object itself. */
  hooks?: string | Record<string, unknown>;
  mcpServers?: string | Record<string, unknown>;
  statusLine?: Record<string, unknown>;
  userConfig: PluginOption[];
}

export interface PluginProblem {
  severity: "error" | "warning";
  /** The file inside the plugin, relative to its root, when not the manifest. */
  file?: string;
  key?: string;
  message: string;
}

/**
 * Everything a plugin adds, in the words the install screen uses. This is
 * the whole list: anything not here is not read.
 */
export interface PluginContents {
  commands: Array<{ name: string; description?: string; /** `!` spans, as written. */ shell: string[] }>;
  hooks: Array<{ event: HookEvent; matcher?: string; type: "command" | "http"; /** The command line or URL, as written. */ run: string }>;
  mcpServers: Array<{ name: string; transport: "stdio" | "http"; /** The command line or URL, as written. */ detail: string }>;
  themes: Array<{ id: string; name: string; appearance: ThemeAppearance; /** A scene name or image file the theme draws behind the conversation. */ backdrop?: string }>;
  profiles: Array<{ id: string; name: string }>;
  styles: Array<{ id: string; name: string }>;
  skills: Array<{ name: string; description?: string }>;
  statusLine?: { items: StatusLineItem[]; command?: string };
}

export function emptyPluginContents(): PluginContents {
  return { commands: [], hooks: [], mcpServers: [], themes: [], profiles: [], styles: [], skills: [] };
}

/** Whether anything in the plugin runs a program: hooks, `!` in commands, stdio MCP servers, a status line command. */
export function pluginRunsCode(contents: PluginContents): boolean {
  return contents.hooks.length > 0
    || contents.commands.some((command) => command.shell.length > 0)
    || contents.mcpServers.some((server) => server.transport === "stdio")
    || Boolean(contents.statusLine?.command);
}

export const PLUGIN_RIGHTS_NOTICE = "Hooks and shell in commands run with your user account's rights.";

/** How the plugin got to the install screen. */
export type PluginSourceKind = "folder" | "zip" | "git" | "dev";

/** What `plugins:inspect` returns: the install confirmation screen and the Validate result. */
export interface PluginInspection {
  /** Hands the staged copy to `plugins:install`. Absent when it cannot be installed. */
  token?: string;
  source: { kind: PluginSourceKind; label: string };
  manifest?: Pick<PluginManifest, "name" | "version" | "description" | "author" | "capsule">;
  contents: PluginContents;
  userConfig: PluginOption[];
  problems: PluginProblem[];
  /** The installed copy this one would replace. */
  installed?: { version: string; dev: boolean };
}

/** An installed or development plugin, as the snapshot carries it. */
export interface PluginView {
  name: string;
  version: string;
  description: string;
  author: string;
  root: string;
  /** Registered in place from a folder, not copied; edits apply on save. */
  dev: boolean;
  enabled: boolean;
  /** The person let this plugin's PermissionRequest hooks answer allow. */
  mayApprove: boolean;
  contents: PluginContents;
  /** Options with their current values. A secret carries only whether it is set. */
  userConfig: Array<PluginOption & { value?: PluginOptionValue; set: boolean }>;
  /** Required options with no value; the plugin cannot be turned on until they have one. */
  missing: string[];
  problems: PluginProblem[];
}

export interface PluginsInspectInput {
  from: PluginSourceKind;
  /** For `git`: an https, ssh or `git@` URL. Folders and zips are picked in main. */
  url?: string;
}

export interface PluginsInstallInput {
  token: string;
  /** Option values the person filled in on the install screen. */
  values?: Record<string, PluginOptionValue>;
}

export interface PluginsConfigureInput {
  name: string;
  values?: Record<string, PluginOptionValue | null>;
  mayApprove?: boolean;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OPTION_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const MANIFEST_KEYS = new Set(["$schema", "name", "version", "description", "author", "capsule", "contributes", "userConfig"]);
const CONTRIBUTION_KEYS = new Set([...PLUGIN_FOLDER_KINDS, "hooks", "mcpServers", "statusLine", "actions"]);

/** Built-in slash commands and harness ids a plugin name may not take, so a plugin cannot pass for part of Capsule. */
const BUILTIN_COMMAND_NAMES = ["new", "inspect", "open", "term", "runtimes", "approvals", "settings", "replay", "acp", "help"];

export function reservedPluginName(name: string): string | undefined {
  if (name === "capsule" || name.startsWith("capsule-")) return `"${name}" is reserved for Capsule itself.`;
  if (BUILTIN_COMMAND_NAMES.includes(name) || (HARNESS_IDS as readonly string[]).includes(name)) return `"${name}" is the name of a built-in command.`;
  if (BUNDLED_THEMES.some((theme) => theme.id === name)) return `"${name}" is the name of a bundled theme.`;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path inside the plugin, written relative to its root. */
export function isPluginRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

/** Validate `capsule-plugin.json`. Errors make the plugin uninstallable; warnings name what is ignored. */
export function parsePluginManifest(raw: unknown, options: { appVersion?: string } = {}): { manifest?: PluginManifest; problems: PluginProblem[] } {
  const problems: PluginProblem[] = [];
  const error = (key: string | undefined, message: string) => problems.push({ severity: "error", ...(key ? { key } : {}), message });
  const warn = (key: string, message: string) => problems.push({ severity: "warning", key, message });
  if (!isRecord(raw)) return { problems: [{ severity: "error", message: `${PLUGIN_MANIFEST_FILE} must hold one JSON object.` }] };
  for (const key of Object.keys(raw)) if (!MANIFEST_KEYS.has(key)) warn(key, `"${key}" is not a plugin manifest key, so it is ignored.`);

  const name = typeof raw.name === "string" ? raw.name : "";
  if (!name) error("name", "name is required.");
  else if (!NAME.test(name)) error("name", `"${name}" is not a valid plugin name. Use lowercase letters, digits and "-", at most 64.`);
  else {
    const reserved = reservedPluginName(name);
    if (reserved) error("name", reserved);
  }
  const version = typeof raw.version === "string" ? raw.version : "";
  if (!version) error("version", "version is required.");
  else if (!VERSION.test(version)) error("version", `"${version}" is not a semantic version such as 1.2.0.`);
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) error("description", "description is required.");
  const author = isRecord(raw.author) && typeof raw.author.name === "string" && raw.author.name.trim()
    ? { name: raw.author.name.trim(), ...(typeof raw.author.url === "string" ? { url: raw.author.url } : {}) }
    : undefined;
  if (!author) error("author", "author.name is required.");
  let capsule: string | undefined;
  if (raw.capsule !== undefined) {
    if (typeof raw.capsule !== "string" || !parseVersionRange(raw.capsule)) error("capsule", `capsule must be a version range such as ">=0.11".`);
    else {
      capsule = raw.capsule;
      if (options.appVersion && !satisfiesVersionRange(options.appVersion, capsule)) error("capsule", `This plugin needs Capsule ${capsule}; this is ${options.appVersion}.`);
    }
  }

  const folders: PluginManifest["folders"] = {};
  let hooks: PluginManifest["hooks"];
  let mcpServers: PluginManifest["mcpServers"];
  let statusLine: PluginManifest["statusLine"];
  if (raw.contributes !== undefined && !isRecord(raw.contributes)) error("contributes", "contributes must be an object.");
  const contributes = isRecord(raw.contributes) ? raw.contributes : {};
  for (const [key, value] of Object.entries(contributes)) {
    const at = `contributes.${key}`;
    if (!CONTRIBUTION_KEYS.has(key)) {
      warn(at, `"${key}" is not something a plugin can contribute, so it is ignored.`);
      continue;
    }
    if (key === "actions") {
      warn(at, "Plugins cannot add project actions yet, so these are ignored.");
      continue;
    }
    if ((PLUGIN_FOLDER_KINDS as readonly string[]).includes(key)) {
      if (typeof value !== "string" || !isPluginRelativePath(value)) error(at, `${at} must be a folder inside the plugin, such as "./${key}".`);
      else folders[key as PluginFolderKind] = value;
      continue;
    }
    if (key === "statusLine") {
      if (!isRecord(value)) error(at, `${at} must be an object.`);
      else statusLine = value;
      continue;
    }
    if (typeof value === "string") {
      if (!isPluginRelativePath(value)) error(at, `${at} must be a JSON file inside the plugin.`);
      else if (key === "hooks") hooks = value;
      else mcpServers = value;
    } else if (isRecord(value)) {
      if (key === "hooks") hooks = value;
      else mcpServers = value;
    } else error(at, `${at} must be a file inside the plugin or an object.`);
  }

  const userConfig: PluginOption[] = [];
  if (raw.userConfig !== undefined && !isRecord(raw.userConfig)) error("userConfig", "userConfig must be an object of options.");
  for (const [key, value] of Object.entries(isRecord(raw.userConfig) ? raw.userConfig : {})) {
    const option = parsePluginOption(key, value, `userConfig.${key}`, problems);
    if (option) userConfig.push(option);
  }

  if (problems.some((problem) => problem.severity === "error") || !author) return { problems };
  return {
    manifest: {
      name, version, description, author,
      ...(capsule ? { capsule } : {}),
      folders,
      ...(hooks !== undefined ? { hooks } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(statusLine !== undefined ? { statusLine } : {}),
      userConfig,
    },
    problems,
  };
}

function parsePluginOption(key: string, value: unknown, at: string, problems: PluginProblem[]): PluginOption | undefined {
  const error = (message: string) => {
    problems.push({ severity: "error", key: at, message });
    return undefined;
  };
  if (!OPTION_KEY.test(key)) return error(`"${key}" is not a valid option name. Use letters, digits and "_".`);
  if (!isRecord(value)) return error(`${at} must be an object.`);
  const type = PLUGIN_OPTION_TYPES.find((item) => item === value.type);
  if (!type) return error(`${at}.type must be one of ${PLUGIN_OPTION_TYPES.join(", ")}.`);
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : undefined;
  if (!title) return error(`${at}.title is required.`);
  let options: string[] | undefined;
  if (type === "enum") {
    if (!Array.isArray(value.options) || value.options.length === 0 || !value.options.every((item) => typeof item === "string")) {
      return error(`${at}.options must list the choices as strings.`);
    }
    options = value.options as string[];
  }
  let fallback: PluginOptionValue | undefined;
  if (value.default !== undefined) {
    if (type === "secret") return error(`${at} is a secret, which cannot have a default.`);
    const checked = checkPluginOptionValue({ key, type, title, ...(options ? { options } : {}) }, value.default);
    if (!checked.ok) return error(`${at}.default ${checked.message}`);
    fallback = checked.value;
  }
  return {
    key, type, title,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(fallback !== undefined ? { default: fallback } : {}),
    ...(options ? { options } : {}),
    ...(value.required === true ? { required: true } : {}),
  };
}

/** Check one option value against its type, coercing a form's text for numbers. */
export function checkPluginOptionValue(option: PluginOption, value: unknown): { ok: true; value: PluginOptionValue } | { ok: false; message: string } {
  switch (option.type) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, message: "must be true or false." };
    case "number": {
      const number = typeof value === "string" && value.trim() ? Number(value) : value;
      return typeof number === "number" && Number.isFinite(number) ? { ok: true, value: number } : { ok: false, message: "must be a number." };
    }
    case "enum":
      return typeof value === "string" && option.options?.includes(value) ? { ok: true, value } : { ok: false, message: `must be one of ${option.options?.join(", ")}.` };
    default:
      return typeof value === "string" ? { ok: true, value } : { ok: false, message: "must be text." };
  }
}

/* ── Variables ── */

/** What `${PLUGIN_ROOT}`, `${PLUGIN_DATA}` and `${user_config.NAME}` stand for in one plugin. */
export interface PluginVariables {
  root: string;
  data: string;
  /** Options that are not secrets, with their values. */
  values: Record<string, string>;
  /** Secret options' keys. Their values never appear in text. */
  secrets: ReadonlySet<string>;
}

/** Where a string is used, which decides what a secret may become there. */
export type PluginTextUse =
  /** A shell command line: an option becomes a reference to its environment variable. */
  | "shell"
  /** An MCP server's `env` or `headers` value: a secret becomes `${env:…}`, filled in at spawn. */
  | "env"
  /** Prompt text, an argument, a URL: secrets are refused. */
  | "text";

const VARIABLE = /\$\{(PLUGIN_ROOT|PLUGIN_DATA|user_config\.([A-Za-z_][A-Za-z0-9_]*))\}/g;

/** The environment variable a hook or status line command reads an option from. */
export function pluginOptionEnvName(key: string): string {
  return `CAPSULE_USER_CONFIG_${key.toUpperCase()}`;
}

/** The variable a plugin's MCP server reads a secret from; unique per plugin, since servers share one environment. */
export function pluginSecretEnvName(plugin: string, key: string): string {
  return `CAPSULE_PLUGIN_${plugin.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${key.toUpperCase()}`;
}

export function substitutePluginVariables(
  text: string,
  plugin: string,
  variables: PluginVariables,
  use: PluginTextUse,
): { text: string; problems: string[] } {
  const problems: string[] = [];
  const result = text.replace(VARIABLE, (match, name: string, option?: string) => {
    if (name === "PLUGIN_ROOT") return variables.root;
    if (name === "PLUGIN_DATA") return variables.data;
    const key = option!;
    if (variables.secrets.has(key)) {
      if (use === "shell") return `\${${pluginOptionEnvName(key)}}`;
      if (use === "env") return `\${env:${pluginSecretEnvName(plugin, key)}}`;
      problems.push(`${match} is a secret, which only reaches environment variables, so it is left out here.`);
      return "";
    }
    if (use === "shell") return `\${${pluginOptionEnvName(key)}}`;
    if (key in variables.values) return variables.values[key]!;
    problems.push(`${match} is not an option this plugin declares.`);
    return "";
  });
  return { text: result, problems };
}

/* ── Versions ── */

/** Semantic version order; unparseable versions compare equal. */
export function comparePluginVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return left && right ? Math.sign(compareParsed(left, right)) : 0;
}

type Range = { op: ">=" | ">" | "<=" | "<" | "=" | "^" | "~"; version: string } | "any";

function parseVersionRange(range: string): Range[] | undefined {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const out: Range[] = [];
  for (const part of parts) {
    if (part === "*") {
      out.push("any");
      continue;
    }
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(part);
    if (!match) return undefined;
    out.push({ op: (match[1] ?? "=") as Exclude<Range, "any">["op"], version: `${match[2]}.${match[3] ?? 0}.${match[4] ?? 0}` });
  }
  return out;
}

/** `>=0.11`, `^1.2.0`, `~1.2`, `1.2.3`, `*`, or several joined by spaces (all must hold). */
export function satisfiesVersionRange(version: string, range: string): boolean {
  const parsed = parseVersionRange(range);
  const current = parseVersion(version);
  if (!parsed || !current) return false;
  const release = `${current.major}.${current.minor}.${current.patch}`;
  return parsed.every((item) => {
    if (item === "any") return true;
    const cmp = comparePluginVersions(release, item.version);
    const [major, minor] = item.version.split(".").map(Number) as [number, number];
    switch (item.op) {
      case ">=": return cmp >= 0;
      case ">": return cmp > 0;
      case "<=": return cmp <= 0;
      case "<": return cmp < 0;
      case "=": return cmp === 0;
      case "^": return cmp >= 0 && (major > 0 ? current.major === major : current.major === 0 && current.minor === minor);
      case "~": return cmp >= 0 && current.major === major && current.minor === minor;
    }
  });
}

/** Words for the install button: a first install, an update, a reinstall or going back. */
export function pluginInstallVerb(inspection: Pick<PluginInspection, "manifest" | "installed">): string {
  const next = inspection.manifest?.version;
  const current = inspection.installed?.version;
  if (!next || !current) return "Install";
  const order = comparePluginVersions(next, current);
  if (order > 0) return `Update from ${current} to ${next}`;
  if (order < 0) return `Go back from ${current} to ${next}`;
  return `Reinstall ${next}`;
}

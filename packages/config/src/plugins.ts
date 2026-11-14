import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  commandNameFromPath,
  describeMcpServer,
  emptyPluginContents,
  EXTENDED_SCHEMA,
  HOOK_EVENTS,
  mcpTransport,
  parseCommandFile,
  parsePluginManifest,
  parseProfileFile,
  parseStyleFile,
  parseTheme,
  PLUGIN_FOLDER_KINDS,
  PLUGIN_MANIFEST_FILE,
  shellSpanCommands,
  splitFrontmatter,
  substitutePluginVariables,
  type ConfigProblem,
  type HookHandler,
  type HookMatcherGroup,
  type HooksConfig,
  type McpServerConfig,
  type PluginContents,
  type PluginFolderKind,
  type PluginManifest,
  type PluginTextUse,
  type PluginVariables,
  type StatusLineConfig,
} from "@capsule/shared";
import { readJsonc } from "./jsonc.js";
import { listResourceFolder, type ResourceFile } from "./resources.js";
import { pruneToSchema, type SchemaIssue } from "./schema-check.js";
import type { ThemeEntry } from "./themes.js";

/** One plugin folder read: its manifest, what it adds, and its contributions as settings values. */
/** Fill a plugin command file's variables the way the reading did; secrets are left out of prompt text. */
export function pluginTextFiller(reading: PluginReading, variables: Omit<PluginVariables, "root">): ((text: string) => string) | undefined {
  const name = reading.manifest?.name;
  if (!name) return undefined;
  const all = { root: reading.root, ...variables };
  return (text) => substitutePluginVariables(text, name, all, "text").text;
}

export interface PluginReading {
  root: string;
  manifestPath: string;
  manifest?: PluginManifest;
  problems: ConfigProblem[];
  /** As written, for the install screen and the plugin list. */
  contents: PluginContents;
  /** Each folder the plugin contributes, checked to sit inside its root. */
  folders: Partial<Record<PluginFolderKind, string>>;
  /** Hooks, MCP servers and status line with variables filled in, ready to be the plugin's settings layer. */
  values: { hooks?: HooksConfig; mcpServers?: Record<string, McpServerConfig>; statusLine?: StatusLineConfig };
  themes: ThemeEntry[];
}

export interface ReadPluginOptions {
  appVersion?: string;
  /** Fill in `${PLUGIN_ROOT}`, `${PLUGIN_DATA}` and options. Without them the values keep the text as written. */
  variables?: (manifest: PluginManifest) => Omit<PluginVariables, "root">;
}

const MAX_SKILL_BYTES = 256 * 1024;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Read a plugin folder without running anything in it. Every problem names
 * the file it is in; an error in the manifest leaves nothing to add.
 */
export function readPluginFolder(rootDir: string, options: ReadPluginOptions = {}): PluginReading {
  const root = path.resolve(rootDir);
  const manifestPath = path.join(root, PLUGIN_MANIFEST_FILE);
  const empty: PluginReading = { root, manifestPath, problems: [], contents: emptyPluginContents(), folders: {}, values: {}, themes: [] };
  const read = readJsonc(manifestPath);
  if (read.state !== "ok") {
    const message = read.state === "missing"
      ? `There is no ${PLUGIN_MANIFEST_FILE} at the top of this folder.`
      : `${read.error.message} Line ${read.error.line}, column ${read.error.column}.`;
    return { ...empty, problems: [{ severity: "error", path: manifestPath, message }] };
  }
  const parsed = parsePluginManifest(read.value, { appVersion: options.appVersion });
  const problems: ConfigProblem[] = parsed.problems.map((problem) => ({ ...problem, path: manifestPath }));
  const manifest = parsed.manifest;
  if (!manifest) return { ...empty, problems };

  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The folder was read a moment ago; a race here only means fewer contributions.
  }
  const folders: PluginReading["folders"] = {};
  for (const kind of PLUGIN_FOLDER_KINDS) {
    const written = manifest.folders[kind];
    const dir = path.resolve(root, written ?? kind);
    if (!existsSync(dir)) {
      if (written) problems.push({ severity: "warning", path: manifestPath, key: `contributes.${kind}`, message: `${written} does not exist, so the plugin adds no ${kind}.` });
      continue;
    }
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (!inside(realRoot, real)) {
      problems.push({ severity: "error", path: manifestPath, key: `contributes.${kind}`, message: `${written ?? kind} leads outside the plugin folder, so it is not read.` });
      continue;
    }
    folders[kind] = dir;
  }

  const variables: PluginVariables | undefined = options.variables ? { root, ...options.variables(manifest) } : undefined;
  const fill = (text: string, use: PluginTextUse, at: string, file: string) => {
    if (!variables) return text;
    const done = substitutePluginVariables(text, manifest.name, variables, use);
    for (const message of done.problems) problems.push({ severity: "warning", path: file, key: at, message });
    return done.text;
  };

  const contents = emptyPluginContents();
  const values: PluginReading["values"] = {};

  if (folders.commands) {
    for (const file of listResourceFolder("commands", "user", folders.commands)) {
      const name = commandNameFromPath(file.name);
      const command = parseCommandFile(name, file.text);
      for (const message of command.problems) problems.push({ severity: command.command ? "warning" : "error", path: file.path, message });
      if (!command.command) continue;
      fill(file.text, "text", name, file.path);
      contents.commands.push({ name, ...(command.command.description ? { description: command.command.description } : {}), shell: shellSpanCommands(command.command.body) });
    }
  }
  const themes: ThemeEntry[] = [];
  if (folders.themes) {
    for (const file of listResourceFolder("themes", "user", folders.themes)) {
      const json = readJsonc(file.path);
      if (json.state !== "ok") {
        problems.push({ severity: "error", path: file.path, message: json.state === "broken" ? `${json.error.message} Line ${json.error.line}, column ${json.error.column}.` : "The file could not be read." });
        continue;
      }
      const theme = parseTheme(json.value, file.name);
      for (const problem of theme.problems) problems.push({ severity: problem.severity, path: file.path, ...(problem.key ? { key: problem.key } : {}), message: problem.message });
      if (!theme.theme) continue;
      themes.push({ theme: theme.theme, source: "plugin", path: file.path, problems: theme.problems });
      const backdrop = theme.theme.backdrop?.image ? path.basename(theme.theme.backdrop.image) : theme.theme.backdrop?.scene;
      contents.themes.push({ id: theme.theme.id, name: theme.theme.name, appearance: theme.theme.appearance, ...(backdrop ? { backdrop } : {}) });
    }
  }
  for (const [kind, parse] of [["profiles", parseProfileFile], ["styles", parseStyleFile]] as const) {
    const dir = folders[kind];
    if (!dir) continue;
    for (const file of listResourceFolder(kind, "user", dir)) {
      const id = commandNameFromPath(file.name);
      const result = parse(id, file.text);
      const entry = "profile" in result ? result.profile : "style" in result ? result.style : undefined;
      for (const message of result.problems) problems.push({ severity: entry ? "warning" : "error", path: file.path, message });
      if (entry) contents[kind].push({ id, name: entry.name });
    }
  }
  if (folders.skills) contents.skills = readSkillNames(folders.skills);

  if (manifest.hooks !== undefined) {
    const loaded = loadJsonContribution(root, manifest.hooks, "hooks", manifestPath, problems);
    if (loaded) {
      const groups = checkSchema("hooks", "hooks" in loaded.value && isRecord(loaded.value.hooks) ? loaded.value.hooks : loaded.value, loaded.file, problems) as HooksConfig | undefined;
      if (groups) {
        const filled: HooksConfig = {};
        for (const event of HOOK_EVENTS) {
          const list = groups[event];
          if (!list?.length) continue;
          filled[event] = list.map((group, index): HookMatcherGroup => ({
            ...(group.matcher ? { matcher: group.matcher } : {}),
            hooks: group.hooks.map((handler): HookHandler => {
              contents.hooks.push({ event, ...(group.matcher ? { matcher: group.matcher } : {}), type: handler.type, run: handler.type === "command" ? handler.command : handler.url });
              const at = `${event}[${index}]`;
              return handler.type === "command"
                ? { ...handler, command: fill(handler.command, "shell", at, loaded.file) }
                : { ...handler, url: fill(handler.url, "text", at, loaded.file), ...(handler.headers ? { headers: mapValues(handler.headers, (value) => fill(value, "text", at, loaded.file)) } : {}) };
            }),
          }));
        }
        values.hooks = filled;
      }
    }
  }

  if (manifest.mcpServers !== undefined) {
    const loaded = loadJsonContribution(root, manifest.mcpServers, "mcpServers", manifestPath, problems);
    if (loaded) {
      const servers = checkSchema("mcpServers", "mcpServers" in loaded.value && isRecord(loaded.value.mcpServers) ? loaded.value.mcpServers : loaded.value, loaded.file, problems) as Record<string, McpServerConfig> | undefined;
      if (servers) {
        const filled: Record<string, McpServerConfig> = {};
        for (const [name, server] of Object.entries(servers)) {
          if (!("command" in server) && !("url" in server)) {
            problems.push({ severity: "warning", path: loaded.file, key: name, message: `${name} has neither command nor url, so it is ignored.` });
            continue;
          }
          contents.mcpServers.push({ name, transport: mcpTransport(server), detail: describeMcpServer(server) });
          const text = (value: string) => fill(value, "text", name, loaded.file);
          const env = (map?: Record<string, string>) => (map ? mapValues(map, (value) => fill(value, "env", name, loaded.file)) : undefined);
          filled[name] = "url" in server
            ? { ...server, url: text(server.url), ...(server.headers ? { headers: env(server.headers) } : {}) }
            : { ...server, command: text(server.command), ...(server.args ? { args: server.args.map(text) } : {}), ...(server.env ? { env: env(server.env) } : {}), ...(server.cwd ? { cwd: text(server.cwd) } : {}) };
        }
        values.mcpServers = filled;
      }
    }
  }

  if (manifest.statusLine !== undefined) {
    const line = checkSchema("statusLine", manifest.statusLine, manifestPath, problems) as StatusLineConfig | undefined;
    if (line) {
      contents.statusLine = { items: line.items ?? [], ...(line.command ? { command: line.command } : {}) };
      values.statusLine = { ...line, ...(line.command ? { command: fill(line.command, "shell", "contributes.statusLine.command", manifestPath) } : {}) };
    }
  }

  return { root, manifestPath, manifest, problems, contents, folders, values, themes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapValues(map: Record<string, string>, fn: (value: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, fn(value)]));
}

/** A contribution given inline in the manifest, or as a JSON file inside the plugin. */
function loadJsonContribution(root: string, written: string | Record<string, unknown>, key: string, manifestPath: string, problems: ConfigProblem[]): { value: Record<string, unknown>; file: string } | undefined {
  if (typeof written !== "string") return { value: written, file: manifestPath };
  const file = path.resolve(root, written);
  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    problems.push({ severity: "error", path: manifestPath, key: `contributes.${key}`, message: `${written} does not exist.` });
    return undefined;
  }
  if (!inside(realpathSync(root), real)) {
    problems.push({ severity: "error", path: manifestPath, key: `contributes.${key}`, message: `${written} leads outside the plugin folder, so it is not read.` });
    return undefined;
  }
  const read = readJsonc(file);
  if (read.state !== "ok" || !isRecord(read.value)) {
    problems.push({ severity: "error", path: file, message: read.state === "broken" ? `${read.error.message} Line ${read.error.line}, column ${read.error.column}.` : "This file must hold one JSON object." });
    return undefined;
  }
  return { value: read.value, file };
}

function checkSchema(key: "hooks" | "mcpServers" | "statusLine", value: unknown, file: string, problems: ConfigProblem[]): unknown {
  const issues: SchemaIssue[] = [];
  const checked = pruneToSchema(EXTENDED_SCHEMA[key].schema, value, key, issues);
  for (const issue of issues) problems.push({ severity: issue.severity, path: file, key: issue.at, message: `${issue.at} ${issue.message}.` });
  return checked.ok ? checked.value : undefined;
}

/** `skills/<name>/SKILL.md`, each named by its folder, with the frontmatter's description. */
function readSkillNames(dir: string): PluginContents["skills"] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: PluginContents["skills"] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    try {
      if (statSync(file).size > MAX_SKILL_BYTES) continue;
      const { fields } = splitFrontmatter(readFileSync(file, "utf8"), []);
      const field = (key: string) => {
        const value = fields.get(key)?.value;
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      };
      const description = field("description");
      skills.push({ name: field("name") ?? entry.name, ...(description ? { description } : {}) });
    } catch {
      // A skill folder without a readable SKILL.md is not a skill.
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** The files of one kind a plugin contributes, as resources from the user's scope, which they rank below. */
export function pluginResources(reading: PluginReading, kind: "profiles" | "styles"): ResourceFile[] {
  const dir = reading.folders[kind];
  return dir ? listResourceFolder(kind, "user", dir) : [];
}

const STAMP_DEPTH = 5;
const STAMP_FILES = 1000;

/** What a plugin folder holds, cheaply: each file's path, size and time, so an edit on save is a change. */
export function pluginFolderStamp(root: string): string {
  const hash = createHash("sha1");
  let count = 0;
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (count >= STAMP_FILES || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < STAMP_DEPTH) walk(full, depth + 1);
        continue;
      }
      try {
        const stat = statSync(full);
        hash.update(`${full}\0${stat.size}\0${stat.mtimeMs}\0`);
        count++;
      } catch {
        // Removed while listing.
      }
    }
  };
  walk(root, 1);
  return hash.digest("hex");
}

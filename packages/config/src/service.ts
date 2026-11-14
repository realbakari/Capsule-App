import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readProjectFile, writeFileAtomic } from "@capsule/filesystem";
import { readProfileCatalog, readStyleCatalog, type ProfileEntry, type StyleEntry } from "./profiles.js";
import {
  BACKDROP_IMAGE_EXTENSIONS,
  decodeThemeShareString,
  DEFAULT_CAPSULE_SETTINGS,
  MAX_BACKDROP_IMAGE_BYTES,
  parseTheme,
  stripBackdropImages,
  THEME_SCHEMA_URL,
  type KeybindingEdit,
  type KeybindingEntry,
  type Theme,
  type ThemeImportResult,
  type ThemeState,
  isMcpServerPatch,
  parsePermissionRule,
  profileTemplate,
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_URL,
  settingSpec,
  shellSpanCommands,
  type AutomationConfig,
  type CapsuleSettings,
  type ConfigDiagnostics,
  type ConfigFileTarget,
  type ConfigProblem,
  type ConfigSourceReport,
  type CustomizationRunRecord,
  type EffectiveExtendedConfig,
  type PendingTrustItem,
  type PermissionRuleEdit,
  type ProjectFileState,
  type Provenance,
  type WritableScope,
  BUNDLED_THEMES,
  checkPluginOptionValue,
  pluginOptionEnvName,
  type PluginManifest,
  type PluginOption,
  type PluginOptionValue,
  type PluginSetting,
} from "@capsule/shared";
import { pluginFolderStamp, pluginResources, pluginTextFiller, readPluginFolder, type PluginReading } from "./plugins.js";
import { commandFolders, readCommandCatalog, type CommandCatalog, type CommandFolder } from "./commands.js";
import { excludeFromGit } from "./git-exclude.js";
import { editJsonc, parseJsonc, readJsonc, writeJsonc, type JsoncEdit, type JsoncFile } from "./jsonc.js";
import { LastGoodStore } from "./last-good.js";
import { mergeLayers, readLayer, type Layer, type LayerReading, type MergedConfig } from "./layers.js";
import { editKeybindingsText, readKeybindings } from "./keybindings.js";
import { ConfigPaths } from "./paths.js";
import { BackdropImages, buildThemeState, readThemeCatalog, type ThemeCatalog } from "./themes.js";
import { listResourceFolder, listResources, type ResourceFile, type ResourceKind } from "./resources.js";
import { isPlainObject, pruneToSchema, type SchemaIssue } from "./schema-check.js";
import type { TrustStore } from "./trust.js";
import { ConfigWatcher, type ConfigWatcherOptions } from "./watcher.js";

export const SAFE_MODE_WRITE_ERROR = "Safe mode is on. Restart normally to change settings files.";

const MAX_RUNS = 50;
const MAX_PERSONAL_BYTES = 32 * 1024;

export interface ConfigServiceOptions {
  userDir: string;
  /** Where the last good copy of every settings file is kept. */
  lastGoodDir: string;
  trust: TrustStore;
  /** Read no file: built-in defaults only, and every write refused. */
  safeMode?: boolean;
  /** The base every layer applies over. */
  defaults?: CapsuleSettings;
  /** Live reload. Off, or tuned, in tests. */
  watch?: boolean | ConfigWatcherOptions;
  /** Where other tools' command folders are looked for when the user turns them on. */
  homeDir?: string;
  /** Checked against a plugin's `capsule` range. */
  appVersion?: string;
}

/** A plugin Capsule knows of: installed under `plugins/`, or registered in place for development. */
export interface KnownPlugin {
  name: string;
  root: string;
  dev: boolean;
  enabled: boolean;
  mayApprove: boolean;
  reading: PluginReading;
  /** Option values that are not secrets, kept in the plugin's data folder. */
  values: Record<string, PluginOptionValue>;
  dataDir: string;
  stamp: string;
}

/** Settings and extended configuration for one project folder. */
export interface ProjectConfig {
  root: string;
  trusted: boolean;
  settings: CapsuleSettings;
  extended: EffectiveExtendedConfig;
  provenance: Partial<Record<string, Provenance>>;
  files: { project: boolean; local: boolean };
}

/** A settings file as last read, and the object Capsule applies from it. */
interface SettingsSource {
  scope: WritableScope;
  path: string;
  file: JsoncFile;
  /** The file's object, or its last good copy while the file is broken. */
  raw?: Record<string, unknown>;
  usingLastGood: boolean;
}

interface ProjectSources {
  project: SettingsSource;
  local: SettingsSource;
  legacy: ProjectFileState;
}

interface Resolution {
  merged: MergedConfig;
  trusted: boolean;
  readings: Array<{ source: SettingsSource; reading?: LayerReading }>;
  legacy?: { path: string; state: ProjectFileState };
}

/**
 * The one stateful owner of settings files: it reads the user's and each
 * requested project's files, validates and merges them, watches them, and
 * writes back to the right layer.
 *
 * Change listeners hear only what the service discovers on disk (an edit, a
 * new file, a reload). Its own writes and trust changes return synchronously
 * and the caller publishes them, so a caller that writes inside a transaction
 * is never re-entered halfway through it.
 */
export class ConfigService {
  readonly paths: ConfigPaths;
  readonly safeMode: boolean;
  /** The base every layer applies over; what Reset falls back to in the user file. */
  readonly defaults: CapsuleSettings;
  private readonly lastGood: LastGoodStore;
  private readonly trustStore: TrustStore;
  private readonly listeners = new Set<() => void>();
  private readonly projects = new Map<string, ProjectSources>();
  private readonly runLog: CustomizationRunRecord[] = [];
  private user: SettingsSource;
  private keybindingsFile: JsoncFile = { state: "missing" };
  private readonly images = new BackdropImages();
  private watcher?: ConfigWatcher;
  /** What every known command and theme folder held at the last read, so an edit to one is a change. */
  private commandFiles = "";
  private knownPlugins: KnownPlugin[] = [];
  private loaded = false;
  private closed = false;

  constructor(private readonly options: ConfigServiceOptions) {
    this.paths = new ConfigPaths(options.userDir);
    this.safeMode = options.safeMode === true;
    this.defaults = options.defaults ?? DEFAULT_CAPSULE_SETTINGS;
    this.lastGood = new LastGoodStore(options.lastGoodDir);
    this.trustStore = options.trust;
    this.user = { scope: "user", path: this.paths.userSettings, file: { state: "missing" }, usingLastGood: false };
  }

  load(): void {
    if (this.loaded || this.closed) return;
    this.loaded = true;
    if (this.safeMode) return;
    this.readUser();
    if (this.options.watch !== false) {
      this.watcher = new ConfigWatcher(() => this.reload(), typeof this.options.watch === "object" ? this.options.watch : {});
      this.watcher.add(this.paths.userDir, "dir");
      for (const plugin of this.knownPlugins) if (plugin.dev) this.watcher.add(plugin.root, "dir");
    }
    this.commandFiles = this.commandFilesStamp();
  }

  /** Effective user-level settings: defaults with the user file applied. */
  settings(): CapsuleSettings {
    return this.resolve().merged.settings;
  }

  provenance(root?: string): Partial<Record<string, Provenance>> {
    return this.resolve(root).merged.provenance;
  }

  extended(root?: string): EffectiveExtendedConfig {
    return this.resolve(root).merged.extended;
  }

  forProject(root: string): ProjectConfig {
    const resolution = this.resolve(root);
    const sources = this.safeMode ? undefined : this.trackProject(root);
    return {
      root: path.resolve(root),
      trusted: resolution.trusted,
      settings: resolution.merged.settings,
      extended: resolution.merged.extended,
      provenance: resolution.merged.provenance,
      files: {
        project: sources !== undefined && sources.project.file.state !== "missing",
        local: sources !== undefined && sources.local.file.state !== "missing",
      },
    };
  }

  isTrusted(root: string): boolean {
    return this.trustStore.isTrusted(root);
  }

  trust(root: string, trusted: boolean): void {
    if (trusted) this.trustStore.trust(root);
    else this.trustStore.revoke(root);
  }

  diagnostics(root?: string): ConfigDiagnostics {
    const userDir = this.paths.userDir;
    const runs = [...this.runLog];
    if (this.safeMode) {
      const skipped = (scope: ConfigSourceReport["scope"], file: string, kind: ConfigSourceReport["kind"] = "settings"): ConfigSourceReport => ({ kind, scope, path: file, state: "skipped" });
      const sources = [skipped("user", this.paths.userSettings), skipped("user", this.paths.keybindings, "keybindings")];
      if (root) sources.push(skipped("project", this.paths.settingsFile("project", root)), skipped("local", this.paths.settingsFile("local", root)));
      return { safeMode: true, userDir, sources, problems: [], trust: root ? this.trustFor(root, []) : undefined, runs, permissions: { allow: [], ask: [], deny: [] }, hooks: {}, hooksDisabled: false };
    }
    const resolution = this.resolve(root);
    const sources: ConfigSourceReport[] = [];
    const problems: ConfigProblem[] = [];
    const pending: PendingTrustItem[] = [];
    for (const { source, reading } of resolution.readings) {
      pending.push(...(reading?.pending ?? []));
      problems.push(...(reading?.problems ?? []));
      sources.push(sourceReport(source, reading, resolution.trusted));
      if (source.file.state === "broken") problems.push(brokenProblem(source.path, source.file.error, source.usingLastGood));
    }
    sources.splice(1, 0, { kind: "keybindings", scope: "user", path: this.paths.keybindings, state: this.keybindingsFile.state, ...(this.keybindingsFile.state === "broken" ? { error: this.keybindingsFile.error } : {}) });
    if (this.keybindingsFile.state === "broken") problems.push(brokenProblem(this.paths.keybindings, this.keybindingsFile.error, false));
    if (resolution.legacy) {
      const { path: file, state } = resolution.legacy;
      sources.push({ kind: "settings", scope: "legacy", path: file, state: state.status === "ok" ? "ok" : "broken", keys: state.status === "ok" && state.file.defaultWorkspaceMode ? ["defaultWorkspaceMode"] : [] });
    }
    const commands = this.commands(root);
    problems.push(...commands.problems);
    problems.push(...this.keybindingsFor(root).problems, ...this.themesFor(root).problems);
    problems.push(...this.profiles(root).problems, ...this.styles(root).problems);
    for (const plugin of this.enabledPlugins()) {
      sources.push({ kind: "plugin", scope: "plugin", path: plugin.reading.manifestPath, state: plugin.reading.manifest ? "ok" : "broken" });
      problems.push(...plugin.reading.problems);
    }
    const personal = this.personalInstructions();
    if (personal?.problem) problems.push({ severity: "warning", path: this.paths.userSettings, key: "personalInstructions", message: personal.problem });
    if (!resolution.trusted) {
      for (const entry of commands.commands) {
        if (entry.scope !== "project") continue;
        for (const command of shellSpanCommands(entry.command.body)) pending.push({ kind: "command-shell", detail: `/${entry.command.name}: ${command}`, path: entry.path });
      }
    }
    const { permissions, hooks, disableAllHooks } = resolution.merged.extended;
    return { safeMode: false, userDir, sources, problems, trust: root ? this.trustFor(root, pending) : undefined, runs, permissions, hooks, hooksDisabled: disableAllHooks };
  }

  /**
   * Add a rule to, or remove one from, a list in the user or project-local
   * file. Rules compare by their canonical text, so `execute( pnpm  test * )`
   * and `execute(pnpm test *)` are the same rule.
   */
  editPermissionRule(edit: Omit<PermissionRuleEdit, "projectId">, root?: string): void {
    const parsed = parsePermissionRule(edit.rule);
    if (!parsed.ok) throw new Error(parsed.message);
    const rule = parsed.rule.text;
    const file = this.paths.settingsFile(edit.scope, root);
    const current = readJsonc(file);
    if (current.state === "broken") {
      throw new Error(`${file} has an error at line ${current.error.line}, column ${current.error.column}. Fix it before Capsule writes to it.`);
    }
    const value = current.state === "ok" && isPlainObject(current.value) ? current.value : {};
    const permissions = isPlainObject(value.permissions) ? value.permissions : {};
    const list = Array.isArray(permissions[edit.list]) ? (permissions[edit.list] as unknown[]) : [];
    const same = (entry: unknown) => {
      if (typeof entry !== "string") return false;
      const other = parsePermissionRule(entry);
      return other.ok && other.rule.text === rule;
    };
    const next = edit.op === "add" ? (list.some(same) ? list : [...list, rule]) : list.filter((entry) => !same(entry));
    if (next.length === list.length && edit.op === "remove") throw new Error(`${rule} is not in ${file}.`);
    if (next === list) return;
    this.setValues(edit.scope, { permissions: { ...permissions, [edit.list]: next } }, root);
  }

  /** Write one key to one layer. `value: undefined` removes it (Reset). */
  setValue(input: { key: string; value?: unknown; scope: WritableScope; root?: string }): void {
    this.setValues(input.scope, { [input.key]: input.value }, input.root);
  }

  /**
   * Write several keys to one layer in one file write, keeping comments.
   * A user-file value equal to the default is removed rather than written.
   * Project files keep a default-equal value, because there it still
   * overrides a person's own setting.
   */
  setValues(scope: WritableScope, values: Record<string, unknown>, root?: string): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const file = this.paths.settingsFile(scope, root);
    const edits: JsoncEdit[] = Object.entries(values).map(([key, value]) => {
      this.assertWritable(key, value, scope);
      const remove = value === undefined || (scope === "user" && isDeepStrictEqual(value, this.defaultValue(key)));
      return { key, value: remove ? undefined : value };
    });
    const current = readJsonc(file);
    if (current.state === "broken") {
      throw new Error(`${file} has an error at line ${current.error.line}, column ${current.error.column}. Fix it before Capsule writes to it.`);
    }
    const created = current.state === "missing";
    if (created && edits.every((edit) => edit.value === undefined)) return;
    const before = created ? settingsTemplate() : current.text;
    const text = editJsonc(before, edits);
    if (created || text !== before) {
      writeJsonc(file, text);
      if (scope === "local" && created) excludeFromGit(file);
    }
    if (scope === "user") this.readUser();
    else if (root) this.readProject(root);
  }

  /** The path for a file or folder, created from a template when missing. */
  ensureFile(target: ConfigFileTarget, root?: string): string {
    if (target.kind === "keybindings") {
      if (!existsSync(this.paths.keybindings)) writeJsonc(this.paths.keybindings, "[]");
      return this.paths.keybindings;
    }
    if (target.kind === "resource") {
      if (target.scope === "project" && !root) throw new Error("Open a project to use its customization folder.");
      const dir = path.join(target.scope === "user" ? this.paths.userDir : this.paths.projectDir(root!), target.folder);
      const file = path.resolve(dir, `${target.name.split(":").join("/")}.md`);
      if (!file.startsWith(`${dir}${path.sep}`) || !existsSync(file)) throw new Error(`There is no ${target.folder.slice(0, -1)} file named ${target.name}.`);
      return file;
    }
    if (target.kind === "folder") {
      if (target.scope === "project" && !root) throw new Error("Open a project to use its customization folder.");
      const dir = path.join(target.scope === "user" ? this.paths.userDir : this.paths.projectDir(root!), target.folder);
      mkdirSync(dir, { recursive: true });
      return dir;
    }
    const file = this.paths.settingsFile(target.scope, root);
    if (!existsSync(file)) {
      writeJsonc(file, settingsTemplate());
      if (target.scope === "local") excludeFromGit(file);
    }
    return file;
  }

  /** Files of one resource kind from the user folder and, given a root, the project's. */
  resources(kind: ResourceKind, root?: string): ResourceFile[] {
    if (this.safeMode) return [];
    const roots: Array<{ scope: "user" | "project"; dir: string }> = [{ scope: "user", dir: this.paths.userDir }];
    if (root) {
      this.trackProject(root);
      roots.push({ scope: "project", dir: this.paths.projectDir(root) });
    }
    return listResources(kind, roots);
  }

  /**
   * Commands from every folder the user and, given a root, the project
   * offer, with a name's highest-precedence file winning.
   */
  commands(root?: string): CommandCatalog {
    if (this.safeMode) return { commands: [], problems: [] };
    if (root) this.trackProject(root);
    return readCommandCatalog(this.commandFolders(root));
  }

  /** Agent profiles from the user's and, given a root, the project's `profiles` folder. */
  profiles(root?: string): { profiles: ProfileEntry[]; problems: ConfigProblem[] } {
    return readProfileCatalog([...this.resources("profiles", root), ...this.enabledPlugins().flatMap((plugin) => pluginResources(plugin.reading, "profiles"))]);
  }

  /** Response styles: files first, then the built-ins a file does not replace. */
  styles(root?: string): { styles: StyleEntry[]; problems: ConfigProblem[] } {
    return readStyleCatalog([...this.resources("styles", root), ...this.enabledPlugins().flatMap((plugin) => pluginResources(plugin.reading, "styles"))]);
  }

  /** The `personalInstructions` file's text, read now. `~` is home and a relative path is in the settings folder. */
  personalInstructions(): { path: string; text?: string; problem?: string } | undefined {
    const written = this.resolve().merged.extended.personalInstructions?.trim();
    if (!written) return undefined;
    const home = this.options.homeDir ?? homedir();
    const file = written === "~" || written.startsWith("~/") ? path.join(home, written.slice(1)) : path.resolve(this.paths.userDir, written);
    try {
      if (statSync(file).size > MAX_PERSONAL_BYTES) return { path: file, problem: `${file} is larger than 32 KB, so it is not sent.` };
      return { path: file, text: readFileSync(file, "utf8") };
    } catch {
      return { path: file, problem: `${file} could not be read, so no personal instructions are sent.` };
    }
  }

  /**
   * Turn one MCP server on or off in the user file, or for one project in its
   * local file. A local entry that only says `enabled` patches the server
   * wherever it is defined; turning one back on removes that patch, and writes
   * `enabled: true` only when the server is off underneath.
   */
  setMcpServerEnabled(input: { name: string; enabled: boolean; scope: "user" | "local"; root?: string }): void {
    const file = this.paths.settingsFile(input.scope, input.root);
    const read = () => {
      const current = readJsonc(file);
      if (current.state === "broken") throw new Error(`${file} has an error at line ${current.error.line}, column ${current.error.column}. Fix it before Capsule writes to it.`);
      const value = current.state === "ok" && isPlainObject(current.value) ? current.value : {};
      return isPlainObject(value.mcpServers) ? (value.mcpServers as Record<string, Record<string, unknown>>) : {};
    };
    const servers = read();
    const entry = isPlainObject(servers[input.name]) ? servers[input.name] : undefined;
    if (input.scope === "user") {
      if (!entry || isMcpServerPatch(entry)) throw new Error(`${input.name} is not defined in ${file}.`);
      this.setValues("user", { mcpServers: { ...servers, [input.name]: { ...entry, enabled: input.enabled } } });
      return;
    }
    if (!input.enabled && entry && !isMcpServerPatch(entry)) {
      this.setValues("local", { mcpServers: { ...servers, [input.name]: { ...entry, enabled: false } } }, input.root);
      return;
    }
    const { [input.name]: _dropped, ...rest } = servers;
    if (!input.enabled) {
      this.setValues("local", { mcpServers: { ...servers, [input.name]: { enabled: false } } }, input.root);
      return;
    }
    if (entry && !isMcpServerPatch(entry)) {
      this.setValues("local", { mcpServers: { ...servers, [input.name]: { ...entry, enabled: true } } }, input.root);
      return;
    }
    this.setValues("local", { mcpServers: Object.keys(rest).length ? rest : undefined }, input.root);
    if (this.resolve(input.root).merged.extended.mcpServers[input.name]?.value.enabled === false) {
      this.setValues("local", { mcpServers: { ...read(), [input.name]: { enabled: true } } }, input.root);
    }
  }

  /** The `automations` array exactly as one file holds it, entries the schema would drop included. */
  private fileAutomations(scope: WritableScope, root?: string): Record<string, unknown>[] {
    const file = this.paths.settingsFile(scope, root);
    const current = readJsonc(file);
    if (current.state === "broken") throw new Error(`${file} has an error at line ${current.error.line}, column ${current.error.column}. Fix it before Capsule writes to it.`);
    const value = current.state === "ok" && isPlainObject(current.value) ? current.value : {};
    return Array.isArray(value.automations) ? (value.automations as Record<string, unknown>[]) : [];
  }

  /**
   * Pause or resume an automation where it is defined. One from a project's
   * shared file is paused by a full copy in your local file, which wins by
   * id, so the team's file is never rewritten; resuming drops that copy.
   */
  setAutomationEnabled(input: { automation: AutomationConfig; source: Provenance; enabled: boolean; root?: string }): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const { automation, enabled } = input;
    const scope: WritableScope = input.source.scope === "user" ? "user" : "local";
    const root = scope === "user" ? undefined : input.root;
    const list = this.fileAutomations(scope, root);
    const index = list.findIndex((entry) => isPlainObject(entry) && entry.id === automation.id);
    if (scope === "user") {
      if (index === -1) throw new Error(`${automation.name} is not in ${this.paths.settingsFile("user")}.`);
      this.setValues("user", { automations: list.map((entry, at) => (at === index ? { ...entry, enabled } : entry)) });
      return;
    }
    const shared = this.fileAutomations("project", root).find((entry) => isPlainObject(entry) && entry.id === automation.id);
    const copyOfShared = (entry: Record<string, unknown>) => shared !== undefined && isDeepStrictEqual({ ...entry, enabled: undefined }, { ...shared, enabled: undefined });
    if (enabled && shared && shared.enabled !== false && (index === -1 || copyOfShared(list[index]!))) {
      const kept = list.filter((_, at) => at !== index);
      this.setValues("local", { automations: kept.length ? kept : undefined }, root);
      return;
    }
    const next = index === -1 ? [...list, { ...(shared ?? automation), enabled }] : list.map((entry, at) => (at === index ? { ...entry, enabled } : entry));
    this.setValues("local", { automations: next }, root);
  }

  /** Append an automation to your file or a project's local file, with an id no other entry there uses. */
  addAutomation(input: { automation: AutomationConfig; scope: "user" | "local"; root?: string }): AutomationConfig {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const root = input.scope === "user" ? undefined : input.root;
    if (input.scope === "local" && !root) throw new Error("Open a project with a folder to add an automation to it.");
    const list = this.fileAutomations(input.scope, root);
    const taken = new Set([...list.map((entry) => entry.id), ...this.extended(root).automations.map((entry) => entry.value.id)]);
    let id = input.automation.id;
    for (let n = 2; taken.has(id); n++) id = `${input.automation.id}-${n}`;
    const automation = { ...input.automation, id };
    this.setValues(input.scope, { automations: [...list, automation] }, root);
    return automation;
  }

  /** Write a new profile file, from the template or as a copy of another profile, and return its path. */
  createProfile(input: { scope: "user" | "project"; root?: string; from?: string }): string {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const source = input.from ? this.profiles(input.root).profiles.find((entry) => entry.profile.id === input.from) : undefined;
    if (input.from && !source) throw new Error(`There is no profile named ${input.from}.`);
    const dir = this.ensureFile({ kind: "folder", folder: "profiles", scope: input.scope }, input.root);
    const base = source ? `${source.profile.id.split(":").pop()}-copy` : "new-profile";
    let id = base;
    for (let n = 2; existsSync(path.join(dir, `${id}.md`)); n++) id = `${base}-${n}`;
    const text = source
      ? readFileSync(source.path, "utf8").replace(/^(---\r?\n(?:[^\n]*\n)*?)name:[^\n]*\n/, `$1name: ${source.profile.name} copy\n`)
      : profileTemplate("New profile");
    const file = path.join(dir, `${id}.md`);
    writeFileAtomic(file, text);
    return file;
  }

  /** keybindings.json's entries. Problems are in `diagnostics`. Safe mode reads none. */
  keybindings(root?: string): KeybindingEntry[] {
    return this.keybindingsFor(root).entries;
  }

  /** Change keybindings.json in place, keeping its comments. */
  editKeybindings(edit: KeybindingEdit): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const file = this.paths.keybindings;
    const current = readJsonc(file);
    if (current.state === "broken") {
      throw new Error(`${file} has an error at line ${current.error.line}, column ${current.error.column}. Fix it before Capsule writes to it.`);
    }
    const before = current.state === "missing" ? "" : current.text;
    const text = editKeybindingsText(before, edit);
    if (text !== before) writeJsonc(file, text);
    this.keybindingsFile = readJsonc(file);
  }

  /** Every theme that can be picked, and what each appearance draws. Problems are in `diagnostics`. */
  themes(root?: string): ThemeState {
    return this.themesFor(root).state;
  }

  /** The checked file behind a `capsule-backdrop:` URL this service handed out. */
  backdropImage(token: string): string | undefined {
    return this.images.file(token);
  }

  /**
   * Save a theme from a share string or a file's text into the user's themes
   * folder. A theme read from elsewhere on disk loses its image, whose path
   * meant something only beside the original file.
   */
  importTheme(source: { kind: "share"; text: string } | { kind: "file"; text: string; name: string }): Extract<ThemeImportResult, { imported: true }> {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    let theme: Theme;
    let problems;
    if (source.kind === "share") {
      const decoded = decodeThemeShareString(source.text);
      if (!decoded.ok) throw new Error(decoded.message);
      ({ theme, problems } = decoded);
    } else {
      const read = parseJsonc(source.text);
      if (read.state !== "ok") throw new Error(read.state === "broken" ? `This file is not valid JSON: ${read.error.message} Line ${read.error.line}, column ${read.error.column}.` : "This file could not be read.");
      const id = source.name.toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-theme";
      const parsed = parseTheme(read.value, id);
      if (!parsed.theme) throw new Error(parsed.problems[0]?.message ?? "This file is not a theme.");
      theme = parsed.theme;
      problems = parsed.problems;
      if (theme.backdrop && JSON.stringify(stripBackdropImages(theme.backdrop)) !== JSON.stringify(theme.backdrop)) {
        problems = [...problems, { severity: "warning" as const, key: "backdrop.image", message: "The theme's image was left behind. Choose an image again in Appearance." }];
      }
    }
    const dir = path.join(this.paths.userDir, "themes");
    mkdirSync(dir, { recursive: true });
    let id = theme.id;
    for (let n = 2; existsSync(path.join(dir, `${id}.json`)); n++) id = `${theme.id}-${n}`;
    const file = path.join(dir, `${id}.json`);
    const backdrop = stripBackdropImages(theme.backdrop);
    writeJsonc(file, JSON.stringify({ $schema: THEME_SCHEMA_URL, name: theme.name, appearance: theme.appearance, tokens: theme.tokens, ...(backdrop ? { backdrop } : {}) }, null, 2));
    this.commandFiles = this.commandFilesStamp();
    return { imported: true, id, name: theme.name, appearance: theme.appearance, path: file, problems };
  }

  /**
   * Copy an image into the settings folder's `backdrops/` and draw it behind
   * the conversation, in place of any scene.
   */
  importBackdropImage(source: string): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const extension = path.extname(source).toLowerCase();
    if (!(BACKDROP_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error("Choose a png, jpg, webp or gif image.");
    const stat = statSync(source);
    if (!stat.isFile()) throw new Error("Choose an image file.");
    if (stat.size > MAX_BACKDROP_IMAGE_BYTES) throw new Error("Choose an image of 8 MB or less.");
    const dir = path.join(this.paths.userDir, "backdrops");
    mkdirSync(dir, { recursive: true });
    const stem = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "backdrop";
    let name = `${stem}${extension}`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) {
      if (readFileSync(path.join(dir, name)).equals(readFileSync(source))) break;
      name = `${stem}-${n}${extension}`;
    }
    if (!existsSync(path.join(dir, name))) copyFileSync(source, path.join(dir, name));
    const selection = this.resolve().merged.extended.theme ?? {};
    const { scene: _scene, ...backdrop } = selection.backdrop ?? {};
    this.setValue({ key: "theme", value: { ...selection, backdrop: { ...backdrop, image: `backdrops/${name}` } }, scope: "user" });
  }

  /* ── Plugins ── */

  /** Where installed plugins live, one folder each, named after the plugin. */
  get pluginsDir(): string {
    return path.join(this.paths.userDir, "plugins");
  }

  /** A plugin's own folder for data that outlives an update: its option values, and whatever its hooks keep. */
  pluginDataDir(name: string): string {
    return path.join(this.paths.userDir, "plugin-data", name);
  }

  /** Every installed and development plugin, on or off. Safe mode knows none. */
  plugins(): KnownPlugin[] {
    return [...this.knownPlugins];
  }

  /** The plugin whose manifest a hook, server or status line came from. */
  pluginFor(source: Provenance | undefined): KnownPlugin | undefined {
    if (source?.scope !== "plugin") return undefined;
    return this.knownPlugins.find((plugin) => plugin.reading.manifestPath === source.path);
  }

  /** A plugin's PermissionRequest hooks may answer allow only once the person has let them. */
  mayApprove(source: Provenance): boolean {
    return source.scope !== "plugin" || this.pluginFor(source)?.mayApprove === true;
  }

  /** What a plugin's hook or status line command finds in its environment, secrets aside. */
  pluginEnvironment(source: Provenance | undefined): Record<string, string> {
    const plugin = this.pluginFor(source);
    if (!plugin) return {};
    const env: Record<string, string> = { CAPSULE_PLUGIN_ROOT: plugin.root, CAPSULE_PLUGIN_DATA: plugin.dataDir };
    for (const [key, value] of Object.entries(plugin.values)) env[pluginOptionEnvName(key)] = String(value);
    return env;
  }

  /** The skills folders of plugins that are on. */
  pluginSkillFolders(): Array<{ name: string; dir: string }> {
    return this.enabledPlugins().flatMap((plugin) => (plugin.reading.folders.skills ? [{ name: plugin.name, dir: plugin.reading.folders.skills }] : []));
  }

  /** Read a folder as a plugin without registering it: the install screen and Validate. */
  inspectPluginFolder(root: string): PluginReading {
    return readPluginFolder(root, { appVersion: this.options.appVersion });
  }

  /**
   * Copy a checked folder into `plugins/<name>`, replacing an older copy.
   * A first install starts off; the caller turns it on once its options are
   * filled in. The settings entry and data folder of an update are kept.
   */
  installPlugin(staged: string): KnownPlugin {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const reading = this.inspectPluginFolder(staged);
    const name = this.assertInstallable(reading);
    const existing = this.knownPlugins.find((plugin) => plugin.name === name);
    if (existing?.dev) throw new Error(`${name} is loaded from ${existing.root} for development. Remove it before installing a copy.`);
    mkdirSync(this.pluginsDir, { recursive: true });
    const target = path.join(this.pluginsDir, name);
    const incoming = path.join(this.pluginsDir, `.incoming-${name}-${process.pid}`);
    const outgoing = path.join(this.pluginsDir, `.outgoing-${name}-${process.pid}`);
    rmSync(incoming, { recursive: true, force: true });
    rmSync(outgoing, { recursive: true, force: true });
    cpSync(staged, incoming, { recursive: true, verbatimSymlinks: true });
    if (existsSync(target)) renameSync(target, outgoing);
    renameSync(incoming, target);
    rmSync(outgoing, { recursive: true, force: true });
    if (!existing) this.writePluginSetting(name, { enabled: false });
    else this.readPlugins();
    return this.requirePlugin(name);
  }

  /** Register a folder in place, for a plugin's author. Nothing is copied, and edits apply on save. */
  registerDevPlugin(root: string): KnownPlugin {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const reading = this.inspectPluginFolder(root);
    const name = this.assertInstallable(reading);
    const existing = this.knownPlugins.find((plugin) => plugin.name === name);
    if (existing && !existing.dev) throw new Error(`A plugin named ${name} is installed. Uninstall it before loading this folder.`);
    this.writePluginSetting(name, { enabled: false, mayApprove: undefined, path: path.resolve(root) });
    this.watcher?.add(path.resolve(root), "dir");
    return this.requirePlugin(name);
  }

  setPluginEnabled(name: string, enabled: boolean): void {
    const plugin = this.requirePlugin(name);
    if (enabled && !plugin.reading.manifest) throw new Error(plugin.reading.problems[0]?.message ?? `${name} cannot be read.`);
    this.writePluginSetting(name, { enabled });
  }

  /** Let, or stop letting, a plugin's PermissionRequest hooks answer allow. */
  setPluginMayApprove(name: string, mayApprove: boolean): void {
    this.requirePlugin(name);
    this.writePluginSetting(name, { mayApprove: mayApprove || undefined });
  }

  /** Save option values that are not secrets in the plugin's data folder. `null` clears one. */
  setPluginValues(name: string, values: Record<string, PluginOptionValue | null>): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const plugin = this.requirePlugin(name);
    const options = plugin.reading.manifest?.userConfig ?? [];
    const next: Record<string, PluginOptionValue> = { ...this.storedPluginValues(name) };
    for (const [key, value] of Object.entries(values)) {
      const option = options.find((item) => item.key === key);
      if (!option) throw new Error(`${name} has no option named ${key}.`);
      if (option.type === "secret") throw new Error(`${option.title} is a secret, which is kept in the Keychain.`);
      if (value === null) {
        delete next[key];
        continue;
      }
      const checked = checkPluginOptionValue(option, value);
      if (!checked.ok) throw new Error(`${option.title} ${checked.message}`);
      next[key] = checked.value;
    }
    const file = path.join(this.pluginDataDir(name), "config.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    this.readPlugins();
  }

  /**
   * Remove a plugin: its settings entry, its option values and, for an
   * installed copy, its folder. A development folder is the author's own and
   * is never deleted.
   */
  uninstallPlugin(name: string): void {
    if (this.safeMode) throw new Error(SAFE_MODE_WRITE_ERROR);
    const plugin = this.requirePlugin(name);
    if (!plugin.dev) rmSync(plugin.root, { recursive: true, force: true });
    rmSync(this.pluginDataDir(name), { recursive: true, force: true });
    const current = this.userPluginSettings();
    const { [name]: _removed, ...rest } = current;
    this.setValues("user", { plugins: Object.keys(rest).length ? rest : undefined });
  }

  private enabledPlugins(): KnownPlugin[] {
    return this.knownPlugins.filter((plugin) => plugin.enabled && plugin.reading.manifest);
  }

  private requirePlugin(name: string): KnownPlugin {
    const plugin = this.knownPlugins.find((item) => item.name === name);
    if (!plugin) throw new Error(`There is no plugin named ${name}.`);
    return plugin;
  }

  private assertInstallable(reading: PluginReading): string {
    const failure = reading.problems.find((problem) => problem.severity === "error");
    if (failure || !reading.manifest) throw new Error(failure?.message ?? "This folder is not a plugin.");
    return reading.manifest.name;
  }

  private userPluginSettings(): Record<string, PluginSetting> {
    const value = this.user.raw?.plugins;
    return isPlainObject(value) ? (value as Record<string, PluginSetting>) : {};
  }

  /** Merge fields into one plugin's entry in the user file; `undefined` removes a field. */
  private writePluginSetting(name: string, patch: Partial<Record<keyof PluginSetting, unknown>>): void {
    const current = this.userPluginSettings();
    const entry: Record<string, unknown> = { ...(isPlainObject(current[name]) ? current[name] : {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete entry[key];
      else entry[key] = value;
    }
    this.setValues("user", { plugins: { ...current, [name]: entry } });
  }

  private storedPluginValues(name: string): Record<string, PluginOptionValue> {
    try {
      const value = JSON.parse(readFileSync(path.join(this.pluginDataDir(name), "config.json"), "utf8")) as unknown;
      return isPlainObject(value) ? (value as Record<string, PluginOptionValue>) : {};
    } catch {
      return {};
    }
  }

  /** Stored values checked against the manifest, with defaults for options never set. */
  private pluginValues(manifest: PluginManifest): Record<string, PluginOptionValue> {
    const stored = this.storedPluginValues(manifest.name);
    const values: Record<string, PluginOptionValue> = {};
    for (const option of manifest.userConfig) {
      if (option.type === "secret") continue;
      const checked = option.key in stored ? checkPluginOptionValue(option, stored[option.key]) : undefined;
      if (checked?.ok) values[option.key] = checked.value;
      else if (option.default !== undefined) values[option.key] = option.default;
    }
    return values;
  }

  private pluginVariables(manifest: PluginManifest, values: Record<string, PluginOptionValue>) {
    return {
      data: this.pluginDataDir(manifest.name),
      values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
      secrets: new Set(manifest.userConfig.filter((option: PluginOption) => option.type === "secret").map((option) => option.key)),
    };
  }

  /** Installed folders, then development folders the user file registers. A second plugin with a name already taken is skipped. */
  private readPlugins(): void {
    if (this.safeMode) return;
    const settings = this.userPluginSettings();
    const found: Array<{ root: string; dev: boolean; folder: string }> = [];
    try {
      for (const entry of readdirSync(this.pluginsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) found.push({ root: path.join(this.pluginsDir, entry.name), dev: false, folder: entry.name });
      }
    } catch {
      // No plugins folder yet.
    }
    for (const [name, setting] of Object.entries(settings)) {
      if (isPlainObject(setting) && typeof setting.path === "string" && setting.path.trim()) found.push({ root: this.userPath(setting.path), dev: true, folder: name });
    }
    const known: KnownPlugin[] = [];
    for (const { root, dev, folder } of found) {
      let values: Record<string, PluginOptionValue> = {};
      const reading = readPluginFolder(root, {
        appVersion: this.options.appVersion,
        variables: (manifest) => {
          values = this.pluginValues(manifest);
          return this.pluginVariables(manifest, values);
        },
      });
      const name = reading.manifest?.name ?? folder;
      if (reading.manifest && name !== folder) {
        reading.problems.push({ severity: "error", path: reading.manifestPath, key: "name", message: `This plugin is named ${name}, but ${dev ? "the settings entry" : "its folder"} is ${folder}. Install it again.` });
        reading.manifest = undefined;
      }
      if (known.some((plugin) => plugin.name === name)) continue;
      const setting = isPlainObject(settings[name]) ? settings[name] : {};
      known.push({
        name, root, dev,
        enabled: setting.enabled === true,
        mayApprove: setting.mayApprove === true,
        reading, values,
        dataDir: this.pluginDataDir(name),
        stamp: pluginFolderStamp(root),
      });
      if (dev) this.watcher?.add(root, "dir");
    }
    this.knownPlugins = known.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** `~` is home and a relative path is in the settings folder, as for personal instructions. */
  private userPath(written: string): string {
    const home = this.options.homeDir ?? homedir();
    return written === "~" || written.startsWith("~/") ? path.join(home, written.slice(1)) : path.resolve(this.paths.userDir, written);
  }

  /** Re-read every file now. Listeners hear about it when anything changed. */
  reload(): boolean {
    if (this.safeMode || this.closed || !this.loaded) return false;
    const before = this.fingerprint();
    const commandsBefore = this.commandFiles;
    this.readUser();
    for (const root of this.projects.keys()) this.readProject(root);
    this.commandFiles = this.commandFilesStamp();
    const changed = this.fingerprint() !== before || this.commandFiles !== commandsBefore;
    if (changed) for (const listener of this.listeners) listener();
    return changed;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Keep a hook or status line run for the doctor; the last 50 are kept. */
  recordRun(record: CustomizationRunRecord): void {
    this.runLog.push(record);
    if (this.runLog.length > MAX_RUNS) this.runLog.splice(0, this.runLog.length - MAX_RUNS);
  }

  runs(): CustomizationRunRecord[] {
    return [...this.runLog];
  }

  close(): void {
    this.closed = true;
    this.watcher?.close();
    this.listeners.clear();
  }

  private keybindingsFor(root?: string): { entries: KeybindingEntry[]; problems: ConfigProblem[] } {
    if (this.safeMode) return { entries: [], problems: [] };
    return readKeybindings(this.keybindingsFile, this.paths.keybindings, this.commands(root).commands.map((entry) => entry.command.name),
      this.profiles(root).profiles.map((entry) => entry.profile.id));
  }

  private themeCatalog(root?: string): ThemeCatalog {
    const bundled = new Set(BUNDLED_THEMES.map((theme) => theme.id));
    return readThemeCatalog(this.resources("themes", root), this.enabledPlugins().flatMap((plugin) => plugin.reading.themes.filter((entry) => !bundled.has(entry.theme.id))));
  }

  private themesFor(root?: string): { state: ThemeState; problems: ConfigProblem[] } {
    const { extended } = this.resolve().merged;
    return buildThemeState({
      catalog: this.safeMode ? readThemeCatalog([]) : this.themeCatalog(root),
      selection: extended.theme,
      overrides: extended.themeOverrides,
      userDir: this.paths.userDir,
      settingsPath: this.paths.userSettings,
      images: this.images,
    });
  }

  private resolve(root?: string): Resolution {
    const trusted = root ? this.trustStore.isTrusted(root) : true;
    if (this.safeMode) return { merged: mergeLayers([], this.defaults), trusted, readings: [] };
    const sources = [this.user];
    let legacy: Resolution["legacy"];
    const layers: Layer[] = [];
    if (root) {
      const project = this.trackProject(root);
      sources.push(project.project, project.local);
      const legacyPath = this.paths.legacyFile(root);
      if (project.legacy.status !== "missing") legacy = { path: legacyPath, state: project.legacy };
      if (project.legacy.status === "ok" && project.legacy.file.defaultWorkspaceMode) {
        layers.push({ scope: "legacy", path: legacyPath, values: { defaultWorkspaceMode: project.legacy.file.defaultWorkspaceMode } });
      }
    }
    const readings = sources.map((source) => ({
      source,
      reading: source.raw ? readLayer(source.raw, { scope: source.scope, path: source.path, trusted }) : undefined,
    }));
    for (const { reading } of readings) if (reading) layers.push(reading.layer);
    // Values were checked against the registry when the plugin was read.
    for (const plugin of this.enabledPlugins()) layers.push({ scope: "plugin", path: plugin.reading.manifestPath, values: plugin.reading.values });
    return { merged: mergeLayers(layers, this.defaults), trusted, readings, legacy };
  }

  private trustFor(root: string, pending: PendingTrustItem[]) {
    const entry = this.trustStore.list().find((item) => item.root === path.resolve(root));
    return { root: path.resolve(root), trusted: Boolean(entry), ...(entry ? { trustedAt: entry.trustedAt } : {}), pending };
  }

  private trackProject(root: string): ProjectSources {
    const key = path.resolve(root);
    const known = this.projects.get(key);
    if (known) return known;
    const sources = this.readProject(key);
    this.watcher?.add(this.paths.projectDir(key), "dir");
    this.watcher?.add(this.paths.legacyFile(key), "file");
    this.commandFiles = this.commandFilesStamp();
    return sources;
  }

  /*
   * Other tools' folders sit outside the watched settings folders, so each
   * one the user turns on gets its own watch.
   */
  private commandFolders(root?: string): CommandFolder[] {
    const folders = commandFolders({
      userDir: this.paths.userDir,
      homeDir: this.options.homeDir ?? homedir(),
      root: root ? path.resolve(root) : undefined,
      sources: this.resolve().merged.extended.commandSources,
      pluginDirs: this.enabledPlugins().flatMap((plugin) => {
        const dir = plugin.reading.folders.commands;
        const fill = pluginTextFiller(plugin.reading, this.pluginVariables(plugin.reading.manifest!, plugin.values));
        return dir ? [{ dir, ...(fill ? { fill } : {}) }] : [];
      }),
    });
    for (const folder of folders) if (folder.source === "claude" || folder.source === "codex") this.watcher?.add(folder.dir, "dir");
    return folders;
  }

  private commandFilesStamp(): string {
    const hash = createHash("sha1");
    for (const root of [undefined, ...this.projects.keys()]) {
      for (const folder of this.commandFolders(root)) {
        for (const file of listResourceFolder("commands", folder.scope, folder.dir)) hash.update(`${file.path}\0${file.text}\0`);
      }
      for (const kind of ["themes", "profiles", "styles"] as const) {
        for (const file of this.resources(kind, root)) hash.update(`${file.path}\0${file.text}\0`);
      }
    }
    for (const plugin of this.knownPlugins) hash.update(`${plugin.root}\0${plugin.stamp}\0`);
    return hash.digest("hex");
  }

  private readUser(): void {
    this.user = this.readSource("user", this.paths.userSettings);
    this.keybindingsFile = readJsonc(this.paths.keybindings);
    this.readPlugins();
  }

  private readProject(root: string): ProjectSources {
    const key = path.resolve(root);
    const sources: ProjectSources = {
      project: this.readSource("project", this.paths.settingsFile("project", key)),
      local: this.readSource("local", this.paths.settingsFile("local", key)),
      legacy: readProjectFile(key),
    };
    this.projects.set(key, sources);
    return sources;
  }

  private readSource(scope: WritableScope, file: string): SettingsSource {
    const read = readJsonc(file);
    if (read.state === "missing") return { scope, path: file, file: read, usingLastGood: false };
    if (read.state === "ok" && isPlainObject(read.value)) {
      this.lastGood.remember(file, read.value);
      return { scope, path: file, file: read, raw: read.value, usingLastGood: false };
    }
    const broken: JsoncFile = read.state === "broken"
      ? read
      : { state: "broken", text: read.text, error: { message: "A settings file must hold one JSON object.", line: 1, column: 1 } };
    const kept = this.lastGood.read(file);
    return isPlainObject(kept)
      ? { scope, path: file, file: broken, raw: kept, usingLastGood: true }
      : { scope, path: file, file: broken, usingLastGood: false };
  }

  private fingerprint(): string {
    const text = (file: JsoncFile) => (file.state === "missing" ? null : file.text);
    return JSON.stringify([
      text(this.user.file),
      text(this.keybindingsFile),
      this.knownPlugins.map((plugin) => [plugin.root, plugin.stamp]),
      [...this.projects].map(([root, sources]) => [root, text(sources.project.file), text(sources.local.file), sources.legacy]),
    ]);
  }

  private assertWritable(key: string, value: unknown, scope: WritableScope): void {
    const spec = settingSpec(key);
    if (!spec) throw new Error(`"${key}" is not a Capsule setting.`);
    if (scope !== "user" && spec.scope === "user") throw new Error(`"${key}" can only be set in your user settings.`);
    if (value === undefined) return;
    const issues: SchemaIssue[] = [];
    const checked = pruneToSchema(spec.schema, value, key, issues);
    const first = issues[0];
    if (!checked.ok || first) throw new Error(first ? `${first.at} ${first.message}.` : `${key} is not a valid value.`);
  }

  private defaultValue(key: string): unknown {
    return key in SETTINGS_SCHEMA ? this.defaults[key as keyof CapsuleSettings] : undefined;
  }
}

function settingsTemplate(): string {
  return `${JSON.stringify({ $schema: SETTINGS_SCHEMA_URL }, null, 2)}\n`;
}

function sourceReport(source: SettingsSource, reading: LayerReading | undefined, trusted: boolean): ConfigSourceReport {
  const base = { kind: "settings" as const, scope: source.scope, path: source.path };
  if (source.file.state === "missing") return { ...base, state: "missing" };
  const keys = Object.keys(reading?.layer.values ?? {});
  if (source.file.state === "broken") return { ...base, state: "broken", keys, error: source.file.error, usingLastGood: source.usingLastGood };
  return { ...base, state: !trusted && reading?.pending.length ? "untrusted" : "ok", keys };
}

function brokenProblem(file: string, error: { message: string; line: number; column: number }, usingLastGood: boolean): ConfigProblem {
  const fallback = usingLastGood ? " Capsule is using its last good copy." : "";
  return { severity: "error", path: file, message: `${error.message} Line ${error.line}, column ${error.column}.${fallback}` };
}

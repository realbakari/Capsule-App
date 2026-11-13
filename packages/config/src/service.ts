import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readProjectFile } from "@capsule/filesystem";
import {
  DEFAULT_CAPSULE_SETTINGS,
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_URL,
  settingSpec,
  type CapsuleSettings,
  type ConfigDiagnostics,
  type ConfigFileTarget,
  type ConfigProblem,
  type ConfigSourceReport,
  type CustomizationRunRecord,
  type EffectiveExtendedConfig,
  type PendingTrustItem,
  type ProjectFileState,
  type Provenance,
  type WritableScope,
} from "@capsule/shared";
import { excludeFromGit } from "./git-exclude.js";
import { editJsonc, readJsonc, writeJsonc, type JsoncEdit, type JsoncFile } from "./jsonc.js";
import { LastGoodStore } from "./last-good.js";
import { mergeLayers, readLayer, type Layer, type LayerReading, type MergedConfig } from "./layers.js";
import { ConfigPaths } from "./paths.js";
import { listResources, type ResourceFile, type ResourceKind } from "./resources.js";
import { isPlainObject, pruneToSchema, type SchemaIssue } from "./schema-check.js";
import type { TrustStore } from "./trust.js";
import { ConfigWatcher, type ConfigWatcherOptions } from "./watcher.js";

export const SAFE_MODE_WRITE_ERROR = "Safe mode is on. Restart normally to change settings files.";

const MAX_RUNS = 50;

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
  private keybindings: JsoncFile = { state: "missing" };
  private watcher?: ConfigWatcher;
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
    }
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
      return { safeMode: true, userDir, sources, problems: [], trust: root ? this.trustFor(root, []) : undefined, runs };
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
    sources.splice(1, 0, { kind: "keybindings", scope: "user", path: this.paths.keybindings, state: this.keybindings.state, ...(this.keybindings.state === "broken" ? { error: this.keybindings.error } : {}) });
    if (this.keybindings.state === "broken") problems.push(brokenProblem(this.paths.keybindings, this.keybindings.error, false));
    if (resolution.legacy) {
      const { path: file, state } = resolution.legacy;
      sources.push({ kind: "settings", scope: "legacy", path: file, state: state.status === "ok" ? "ok" : "broken", keys: state.status === "ok" && state.file.defaultWorkspaceMode ? ["defaultWorkspaceMode"] : [] });
    }
    return { safeMode: false, userDir, sources, problems, trust: root ? this.trustFor(root, pending) : undefined, runs };
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

  /** Re-read every file now. Listeners hear about it when anything changed. */
  reload(): boolean {
    if (this.safeMode || this.closed || !this.loaded) return false;
    const before = this.fingerprint();
    this.readUser();
    for (const root of this.projects.keys()) this.readProject(root);
    const changed = this.fingerprint() !== before;
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
    return sources;
  }

  private readUser(): void {
    this.user = this.readSource("user", this.paths.userSettings);
    this.keybindings = readJsonc(this.paths.keybindings);
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
      text(this.keybindings),
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

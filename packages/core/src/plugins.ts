import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConfigService, KnownPlugin, PluginReading } from "@capsule/config";
import {
  PLUGIN_MANIFEST_FILE,
  pluginOptionEnvName,
  pluginSecretEnvName,
  type PluginInspection,
  type PluginOptionValue,
  type PluginProblem,
  type PluginSourceKind,
  type PluginView,
  type Provenance,
} from "@capsule/shared";
import { runProgram } from "@capsule/terminal";
import { CAPSULE_KEYCHAIN_SERVICE, type KeychainAdapter } from "./keychain.js";

/** Where a plugin to inspect is. Main picks folders and zips; the renderer never names a path. */
export type PluginSource =
  | { kind: "folder"; path: string }
  | { kind: "zip"; path: string }
  | { kind: "dev"; path: string }
  | { kind: "git"; url: string };

interface Stage {
  root: string;
  /** The temporary folder to remove; absent for a development folder, which is read in place. */
  temp?: string;
  source: PluginInspection["source"];
  dev: boolean;
  /** Set once the staged copy has been read. */
  name?: string;
}

const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;
const GIT_URL = /^(https:\/\/|ssh:\/\/|git@[\w.-]+:|file:\/\/)/;

function secretAccount(plugin: string, key: string): string {
  return `plugin.${plugin}.${key}`;
}

function relative(root: string, file: string): string | undefined {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : undefined;
}

export function pluginProblems(reading: PluginReading): PluginProblem[] {
  return reading.problems.map((problem) => {
    const file = relative(reading.root, problem.path);
    return { severity: problem.severity, ...(file && file !== PLUGIN_MANIFEST_FILE ? { file } : {}), ...(problem.key ? { key: problem.key } : {}), message: problem.message };
  });
}

/**
 * Installing, configuring and removing plugins: fetching a source into a
 * temporary folder Capsule controls, keeping secret options in the Keychain,
 * and the environment a plugin's programs get. What a plugin adds is the
 * config service's business.
 */
export class PluginManager {
  private readonly stages = new Map<string, Stage>();
  /** Secret option values by plugin, read from the Keychain at start and kept current by every write here. */
  private readonly secrets = new Map<string, Map<string, string>>();

  constructor(private readonly host: { config: ConfigService; keychain: KeychainAdapter; log?: (message: string) => void }) {}

  /** Read every known plugin's secrets, so hooks and servers can be given them without waiting on the Keychain. */
  async loadSecrets(): Promise<void> {
    for (const plugin of this.host.config.plugins()) await this.loadPluginSecrets(plugin);
  }

  private async loadPluginSecrets(plugin: KnownPlugin): Promise<void> {
    const values = new Map<string, string>();
    for (const option of plugin.reading.manifest?.userConfig ?? []) {
      if (option.type !== "secret") continue;
      try {
        const value = await this.host.keychain.get(CAPSULE_KEYCHAIN_SERVICE, secretAccount(plugin.name, option.key));
        if (value) values.set(option.key, value);
      } catch (error) {
        this.host.log?.(`The Keychain did not return ${plugin.name}'s ${option.key}: ${String(error)}`);
      }
    }
    this.secrets.set(plugin.name, values);
  }

  /** Copy or fetch a plugin into a folder Capsule controls and read it there, so what is listed is what gets installed. */
  async inspect(source: PluginSource): Promise<PluginInspection> {
    const stage = await this.stage(source);
    const reading = this.host.config.inspectPluginFolder(stage.root);
    const problems = pluginProblems(reading);
    const manifest = reading.manifest;
    const installed = manifest ? this.host.config.plugins().find((plugin) => plugin.name === manifest.name) : undefined;
    if (manifest && installed?.dev && !stage.dev) problems.push({ severity: "error", message: `${manifest.name} is loaded from ${installed.root} for development. Remove it before installing a copy.` });
    if (manifest && installed && !installed.dev && stage.dev) problems.push({ severity: "error", message: `A plugin named ${manifest.name} is installed. Uninstall it before loading this folder.` });
    const installable = manifest && !problems.some((problem) => problem.severity === "error");
    let token: string | undefined;
    if (installable) {
      token = randomUUID();
      this.stages.set(token, { ...stage, name: manifest.name });
    } else this.discardStage(stage);
    return {
      ...(token ? { token } : {}),
      source: stage.source,
      ...(manifest ? { manifest: { name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, ...(manifest.capsule ? { capsule: manifest.capsule } : {}) } } : {}),
      contents: reading.contents,
      userConfig: manifest?.userConfig ?? [],
      problems,
      ...(installed?.reading.manifest ? { installed: { version: installed.reading.manifest.version, dev: installed.dev } } : {}),
    };
  }

  /**
   * Install what `inspect` staged, or register a development folder, then
   * store the options filled in on the install screen. A plugin is turned on
   * when it has every required option; an update keeps its on or off state.
   */
  async install(token: string, values: Record<string, PluginOptionValue> = {}): Promise<KnownPlugin> {
    const stage = this.stages.get(token);
    if (!stage) throw new Error("Inspect the plugin again; this install screen is out of date.");
    this.stages.delete(token);
    try {
      const before = this.host.config.plugins().find((plugin) => plugin.name === stage.name);
      const plugin = stage.dev ? this.host.config.registerDevPlugin(stage.root) : this.host.config.installPlugin(stage.root);
      await this.configure(plugin.name, values);
      const missing = this.missing(this.require(plugin.name));
      if (missing.length > 0) {
        if (this.require(plugin.name).enabled) this.host.config.setPluginEnabled(plugin.name, false);
      } else if (!before) this.host.config.setPluginEnabled(plugin.name, true);
      return this.require(plugin.name);
    } finally {
      this.discardStage(stage);
    }
  }

  discard(token: string): void {
    const stage = this.stages.get(token);
    this.stages.delete(token);
    if (stage) this.discardStage(stage);
  }

  /** Store option values: secrets in the Keychain, the rest in the plugin's data folder. `null` clears one. */
  async configure(name: string, values: Record<string, PluginOptionValue | null>, mayApprove?: boolean): Promise<void> {
    const plugin = this.require(name);
    const options = plugin.reading.manifest?.userConfig ?? [];
    const plain: Record<string, PluginOptionValue | null> = {};
    const secrets: Array<[string, string | null]> = [];
    for (const [key, value] of Object.entries(values)) {
      const option = options.find((item) => item.key === key);
      if (!option) throw new Error(`${name} has no option named ${key}.`);
      if (option.type !== "secret") plain[key] = value;
      else if (value === null || value === "") secrets.push([key, null]);
      else if (typeof value !== "string") throw new Error(`${option.title} must be text.`);
      else secrets.push([key, value]);
    }
    if (Object.keys(plain).length) this.host.config.setPluginValues(name, plain);
    for (const [key, value] of secrets) {
      if (value === null) await this.host.keychain.delete(CAPSULE_KEYCHAIN_SERVICE, secretAccount(name, key));
      else await this.host.keychain.set(CAPSULE_KEYCHAIN_SERVICE, secretAccount(name, key), value);
    }
    if (secrets.length) await this.loadPluginSecrets(this.require(name));
    if (mayApprove !== undefined) this.host.config.setPluginMayApprove(name, mayApprove);
  }

  setEnabled(name: string, enabled: boolean): void {
    const plugin = this.require(name);
    const missing = enabled ? this.missing(plugin) : [];
    if (missing.length) throw new Error(`Fill in ${missing.join(", ")} before turning ${name} on.`);
    this.host.config.setPluginEnabled(name, enabled);
  }

  async uninstall(name: string): Promise<void> {
    const plugin = this.require(name);
    for (const option of plugin.reading.manifest?.userConfig ?? []) {
      if (option.type === "secret") await this.host.keychain.delete(CAPSULE_KEYCHAIN_SERVICE, secretAccount(name, option.key)).catch(() => undefined);
    }
    this.secrets.delete(name);
    this.host.config.uninstallPlugin(name);
  }

  /** The environment a plugin's hook or status line command runs with: its folders and every option, secrets included. */
  environment(source: Provenance | undefined): Record<string, string> {
    const plugin = this.host.config.pluginFor(source);
    if (!plugin) return {};
    const env = this.host.config.pluginEnvironment(source);
    for (const [key, value] of this.secrets.get(plugin.name) ?? []) env[pluginOptionEnvName(key)] = value;
    return env;
  }

  /** Secrets of plugins that are on, under the names their MCP servers' `${env:…}` references use. */
  serverEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const plugin of this.host.config.plugins()) {
      if (!plugin.enabled) continue;
      for (const [key, value] of this.secrets.get(plugin.name) ?? []) env[pluginSecretEnvName(plugin.name, key)] = value;
    }
    return env;
  }

  views(): PluginView[] {
    return this.host.config.plugins().map((plugin) => {
      const manifest = plugin.reading.manifest;
      const secrets = this.secrets.get(plugin.name);
      return {
        name: plugin.name,
        version: manifest?.version ?? "",
        description: manifest?.description ?? "",
        author: manifest?.author.name ?? "",
        root: plugin.root,
        dev: plugin.dev,
        enabled: plugin.enabled,
        mayApprove: plugin.mayApprove,
        contents: plugin.reading.contents,
        userConfig: (manifest?.userConfig ?? []).map((option) => option.type === "secret"
          ? { ...option, set: Boolean(secrets?.has(option.key)) }
          : { ...option, ...(option.key in plugin.values ? { value: plugin.values[option.key] } : {}), set: option.key in plugin.values }),
        missing: this.missing(plugin),
        problems: pluginProblems(plugin.reading),
      };
    });
  }

  /** Required options with no value, by title. */
  private missing(plugin: KnownPlugin): string[] {
    const secrets = this.secrets.get(plugin.name);
    return (plugin.reading.manifest?.userConfig ?? [])
      .filter((option) => option.required && !(option.type === "secret" ? secrets?.has(option.key) : option.key in plugin.values))
      .map((option) => option.title);
  }

  private require(name: string): KnownPlugin {
    const plugin = this.host.config.plugins().find((item) => item.name === name);
    if (!plugin) throw new Error(`There is no plugin named ${name}.`);
    return plugin;
  }

  private async stage(source: PluginSource): Promise<Stage> {
    if (source.kind === "dev") return { root: path.resolve(source.path), source: { kind: "dev", label: source.path }, dev: true };
    const temp = mkdtempSync(path.join(tmpdir(), "capsule-plugin-"));
    try {
      const raw = path.join(temp, "raw");
      const label = source.kind === "git" ? source.url : source.path;
      if (source.kind === "folder") {
        mkdirSync(raw);
        cleanCopy(source.path, raw);
      } else if (source.kind === "zip") {
        await this.unzip(source.path, raw);
      } else {
        await this.clone(source.url, raw, temp);
      }
      const top = pluginTop(raw);
      const root = path.join(temp, "plugin");
      cleanCopy(top, root);
      return { root, temp, source: { kind: source.kind, label }, dev: false };
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
  }

  private async unzip(file: string, into: string): Promise<void> {
    mkdirSync(into, { recursive: true });
    const run = process.platform === "darwin"
      ? await runProgram(path.dirname(file), "ditto", ["-x", "-k", file, into], { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: 8192 })
      : await runProgram(path.dirname(file), "unzip", ["-q", file, "-d", into], { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: 8192 });
    if (run.code !== 0) throw new Error(`The zip could not be opened${run.timedOut ? " in time" : ""}: ${run.stderr.trim() || `exit ${run.code}`}`);
  }

  private async clone(url: string, into: string, cwd: string): Promise<void> {
    const trimmed = url.trim();
    if (!GIT_URL.test(trimmed)) throw new Error("Use an https, ssh or git@ address for the repository.");
    const run = await runProgram(cwd, "git", ["-c", "protocol.ext.allow=never", "clone", "--depth", "1", "--no-tags", "--single-branch", "--", trimmed, into], {
      env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: 8192,
    });
    if (run.code !== 0) throw new Error(`git could not clone ${trimmed}${run.timedOut ? " in time" : ""}: ${run.stderr.trim().split("\n").pop() || `exit ${run.code}`}`);
  }

  private discardStage(stage: Stage): void {
    if (stage.temp) rmSync(stage.temp, { recursive: true, force: true });
  }
}

/** The manifest at the top, or inside the one folder a zip or archive wraps it in. */
function pluginTop(raw: string): string {
  if (existsSync(path.join(raw, PLUGIN_MANIFEST_FILE))) return raw;
  const entries = readdirSync(raw, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".") && entry.name !== "__MACOSX");
  const only = entries.length === 1 && entries[0]!.isDirectory() ? path.join(raw, entries[0]!.name) : undefined;
  if (only && existsSync(path.join(only, PLUGIN_MANIFEST_FILE))) return only;
  throw new Error(`There is no ${PLUGIN_MANIFEST_FILE} at the top of this plugin.`);
}

/**
 * Copy a plugin without links, `.git`, or anything past the size limits. A
 * link could point anywhere on this computer, so it is never carried along.
 */
function cleanCopy(from: string, to: string): void {
  let files = 0;
  let bytes = 0;
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      if (source !== from && (name === ".git" || name === "__MACOSX" || name === ".DS_Store")) return false;
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) return false;
      if (stat.isFile()) {
        files++;
        bytes += stat.size;
        if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error("This plugin is larger than 5,000 files or 50 MB.");
      }
      return stat.isFile() || stat.isDirectory();
    },
  });
}

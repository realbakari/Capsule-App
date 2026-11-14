import {
  SETTINGS_SCHEMA,
  SETTINGS_SECTION_KEYS,
  type CapsuleSettings,
  type ConfigDiagnostics,
  type ConfigFileTarget,
  type ConfigScope,
  type ConfigSnapshot,
  type ConfigSourceReport,
  type PendingTrustItem,
  type Provenance,
  type WritableScope,
} from "@capsule/shared";

/**
 * The renderer's reading of the settings files: which file set a value, which
 * layer a change is written to, and what the doctor lists first. The renderer
 * never reads a file; everything here works on the snapshot main sends.
 */

type FileScope = Exclude<ConfigScope, "default">;

const FILE_LABELS: Record<FileScope, string> = {
  user: "user file",
  project: "project",
  local: "project (local)",
  legacy: "capsule.json",
  plugin: "plugin",
};

/** The "Save to" choices, in the order the control shows them. */
export const SAVE_TARGETS: ReadonlyArray<{ scope: WritableScope; label: string; detail: string }> = [
  { scope: "user", label: "You", detail: "Your user settings file, for every project." },
  { scope: "project", label: "This project", detail: "The project's .capsule/settings.json, shared with everyone who commits it." },
  { scope: "local", label: "This project, only me", detail: "The project's .capsule/settings.local.json, never committed." },
];

/** A file that set a value, as a provenance chip names and opens it. */
export interface SettingSourceChip {
  label: string;
  /** `legacy` is capsule.json, which the project screen edits; `plugin` is a plugin's manifest. Reset removes from neither. */
  layer: WritableScope | "legacy" | "plugin";
  path: string;
}

export function sourceChip(provenance: Provenance | undefined): SettingSourceChip | undefined {
  if (!provenance || provenance.scope === "default" || !provenance.path) return undefined;
  return { label: FILE_LABELS[provenance.scope], layer: provenance.scope, path: provenance.path };
}

/** Whether a value came from one of the project's own files. */
export function fromProjectFile(provenance: Provenance | undefined): boolean {
  return provenance?.scope === "project" || provenance?.scope === "local" || provenance?.scope === "legacy";
}

export function settingsFileTarget(scope: WritableScope, projectId?: string): ConfigFileTarget {
  return scope === "user" || !projectId ? { kind: "settings", scope: "user" } : { kind: "settings", scope, projectId };
}

/** How to open a file the doctor lists: through main for a settings or key bindings file, by path otherwise. */
export function sourceFileTarget(source: Pick<ConfigSourceReport, "kind" | "scope">, projectId?: string): ConfigFileTarget | undefined {
  if (source.kind === "keybindings") return { kind: "keybindings" };
  if (source.kind !== "settings" || source.scope === "legacy" || source.scope === "default") return undefined;
  if (source.scope === "plugin" || (source.scope !== "user" && !projectId)) return undefined;
  return settingsFileTarget(source.scope, projectId);
}

/** Keys only the user file may set. Unknown keys and secrets count as the user's. */
export function isUserOnly(key: string): boolean {
  return (SETTINGS_SCHEMA as Record<string, { scope: "user" | "both" } | undefined>)[key]?.scope !== "both";
}

/** The layer a key is written to when Settings saves to `target`. */
export function writeScope(key: string, target: WritableScope): WritableScope {
  return target !== "user" && !isUserOnly(key) ? target : "user";
}

/**
 * A change from the Settings screen, split by where it goes. Keys a project
 * may set go to the chosen project layer; everything else, secrets included,
 * goes through the user save, which also keeps the Keychain and the derived
 * records in step.
 */
export function routeSettingsPatch(
  patch: Partial<CapsuleSettings>,
  target: WritableScope,
): { user: Partial<CapsuleSettings>; layer: Array<{ key: string; value: unknown }> } {
  const user: Record<string, unknown> = {};
  const layer: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (writeScope(key, target) === "user") user[key] = value;
    else layer.push({ key, value });
  }
  return { user: user as Partial<CapsuleSettings>, layer };
}

/** Whether any setting in a Settings section can live in a project file, so "Save to" means something there. */
export function sectionTakesProjectValues(section: string): boolean {
  return (SETTINGS_SECTION_KEYS[section] ?? []).some((key) => !isUserOnly(key));
}

/** What the Settings screen shows for a save target: values and the file each came from. */
export interface SettingsLayerView {
  target: WritableScope;
  settings: CapsuleSettings;
  provenance: Partial<Record<string, Provenance>>;
}

/**
 * Your own values when saving to your file, the project's merged values when
 * saving to one of its files. Without a project snapshot there is only yours.
 */
export function settingsLayerView(user: CapsuleSettings, snapshot: ConfigSnapshot | undefined, target: WritableScope): SettingsLayerView {
  if (target === "user" || !snapshot?.project) return { target: "user", settings: user, provenance: snapshot?.provenance ?? {} };
  return { target, settings: snapshot.project.settings, provenance: snapshot.project.provenance };
}

/** The open project's settings with its files applied, when the snapshot is for that project. */
export function projectSettingsFor(snapshot: ConfigSnapshot | undefined, projectId: string | undefined): CapsuleSettings | undefined {
  return projectId && snapshot?.project?.projectId === projectId ? snapshot.project.settings : undefined;
}

/** Keys some file set, for the `@modified` settings search. */
export function modifiedKeys(snapshot: ConfigSnapshot | undefined): Set<string> {
  const keys = new Set<string>();
  for (const provenance of [snapshot?.provenance, snapshot?.project?.provenance]) {
    for (const [key, source] of Object.entries(provenance ?? {})) if (source && source.scope !== "default") keys.add(key);
  }
  return keys;
}

const SCOPE_RANK: Record<ConfigScope, number> = { local: 0, project: 1, legacy: 2, user: 3, plugin: 4, default: 5 };

/** Settings files strongest first, then the other files Capsule read. */
export function sourcesByPrecedence(sources: readonly ConfigSourceReport[]): ConfigSourceReport[] {
  return [...sources].sort((a, b) =>
    Number(a.kind !== "settings") - Number(b.kind !== "settings") || SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
}

export const PENDING_KIND_LABELS: Record<PendingTrustItem["kind"], string> = {
  hook: "Hook",
  "command-shell": "Command shell",
  "mcp-server": "MCP server",
  automation: "Automation",
  "permission-allow": "Allow rule",
  "status-line": "Status line command",
};

/** What the open project wants to run once trusted. Empty when it is trusted or the diagnostics are another project's. */
export function pendingTrust(snapshot: ConfigSnapshot | undefined, diagnostics: ConfigDiagnostics | undefined): PendingTrustItem[] {
  const project = snapshot?.project;
  const trust = diagnostics?.trust;
  if (!project || !trust || project.trusted || trust.root !== project.root) return [];
  return trust.pending;
}

/** The broken files already announced, by path, with the error each was announced for. */
export type AnnouncedBreaks = ReadonlyMap<string, string>;

/**
 * Which files to announce as broken, once per break. A file announced stays
 * quiet until it parses again or breaks somewhere else; a file that another
 * project's diagnostics do not mention keeps its record.
 */
export function trackBrokenFiles(announced: AnnouncedBreaks, diagnostics: ConfigDiagnostics): { announced: AnnouncedBreaks; announce: ConfigSourceReport[] } {
  const next = new Map(announced);
  const announce: ConfigSourceReport[] = [];
  for (const source of diagnostics.sources) {
    if (source.state !== "broken") {
      if (source.state !== "skipped") next.delete(source.path);
      continue;
    }
    const error = source.error ? `${source.error.line}:${source.error.column} ${source.error.message}` : "";
    if (next.get(source.path) === error) continue;
    next.set(source.path, error);
    announce.push(source);
  }
  return { announced: next, announce };
}

/** A parser or validator message as the end of a sentence, without a doubled full stop. */
export function asSentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** A path as a person reads it: home as ~, and only the folders that tell two settings.json apart. */
export function shortConfigPath(file: string, home?: string): string {
  const withHome = home && file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
  const parts = withHome.split("/");
  return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : withHome;
}

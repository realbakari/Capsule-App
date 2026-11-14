import {
  HOOK_EVENTS,
  isMcpServerPatch,
  normalizeCapsuleSettings,
  settingSpec,
  SETTINGS_SCHEMA,
  type AutomationConfig,
  type CapsuleSettings,
  type ConfigKey,
  type ConfigProblem,
  type ConfigScope,
  type EffectiveExtendedConfig,
  type ExtendedConfig,
  type ExtendedConfigKey,
  type HookMatcherGroup,
  type McpServerConfig,
  type PendingTrustItem,
  type Provenance,
  type Sourced,
} from "@capsule/shared";
import { gateUntrusted, restrictProjectValue } from "./project-policy.js";
import { pruneToSchema, type SchemaIssue } from "./schema-check.js";

export type LayerScope = Exclude<ConfigScope, "default">;

/** One file's values after validation, ready to merge. */
export interface Layer {
  scope: LayerScope;
  path: string;
  values: Record<string, unknown>;
}

export interface LayerReading {
  layer: Layer;
  problems: ConfigProblem[];
  pending: PendingTrustItem[];
}

export interface MergedConfig {
  /** Normalized settings. Secrets are never in a file, so they are absent here. */
  settings: CapsuleSettings;
  extended: EffectiveExtendedConfig;
  /** The highest-precedence file that set each top-level key. Absent keys are defaults. */
  provenance: Partial<Record<string, Provenance>>;
}

/** Lowest first. A thread's own choice sits above all of these and is not a file. */
const PRECEDENCE: Record<LayerScope, number> = { plugin: -1, user: 0, legacy: 1, project: 2, local: 3 };

const SECRET_KEYS = new Set(["gatewayToken", "skillsShToken"]);

/**
 * Validate one file against the key registry. Every rejected key or entry
 * becomes a problem and the rest of the file still applies.
 */
export function readLayer(raw: Record<string, unknown>, file: { scope: LayerScope; path: string; trusted: boolean }): LayerReading {
  const { scope, path, trusted } = file;
  // An installed plugin is the person's own choice, so it reads like their file.
  const fromProject = scope === "project" || scope === "local" || scope === "legacy";
  const problems: ConfigProblem[] = [];
  const pending: PendingTrustItem[] = [];
  const values: Record<string, unknown> = {};
  const report = (severity: ConfigProblem["severity"], key: string, message: string) => problems.push({ severity, path, key, message });
  for (const [key, value] of Object.entries(raw)) {
    if (key === "$schema") continue;
    const spec = settingSpec(key);
    if (!spec) {
      report("warning", key, SECRET_KEYS.has(key)
        ? "Secrets are kept in the Keychain, not in a file. This value is ignored; remove it."
        : `"${key}" is not a Capsule setting.`);
      continue;
    }
    if (fromProject && spec.scope === "user") {
      report("warning", key, `"${key}" can only be set in your user settings. The project's value is ignored.`);
      continue;
    }
    const issues: SchemaIssue[] = [];
    const checked = pruneToSchema(spec.schema, value, key, issues);
    for (const issue of issues) report(issue.severity, issue.at, `${issue.at} ${issue.message}.`);
    if (!checked.ok) continue;
    let next = checked.value;
    if (fromProject) {
      const restricted = restrictProjectValue(key as ConfigKey, next);
      for (const removed of restricted.removed) report("warning", removed.at, removed.message);
      next = restricted.value;
      if (next === undefined) continue;
      if (spec.needsTrust && !trusted) {
        const gated = gateUntrusted(key as ConfigKey, next, path);
        pending.push(...gated.held);
        if (gated.applied === undefined) continue;
        next = gated.applied;
      }
    }
    values[key] = next;
  }
  return { layer: { scope, path, values }, problems, pending };
}

type Merger<K extends ExtendedConfigKey> = (
  current: EffectiveExtendedConfig[K],
  next: NonNullable<ExtendedConfig[K]>,
  source: Provenance,
) => EffectiveExtendedConfig[K];

const replace = <K extends ExtendedConfigKey>(): Merger<K> => (_current, next) => next as EffectiveExtendedConfig[K];
const byKey = <K extends "themeOverrides" | "commandSources" | "plugins">(): Merger<K> =>
  (current, next) => ({ ...current, ...next }) as EffectiveExtendedConfig[K];
const sourced = <T>(value: T, source: Provenance): Sourced<T> => ({ value, source });

/**
 * How each extended key combines across files. Scalars and plain arrays
 * replace. Rule lists and hook groups concatenate. Maps merge by key, and
 * automations merge by id, so a project can add one without hiding the user's.
 */
const MERGERS: { [K in ExtendedConfigKey]: Merger<K> } = {
  permissions: (current, next, source) => ({
    allow: [...current.allow, ...(next.allow ?? []).map((rule) => sourced(rule, source))],
    ask: [...current.ask, ...(next.ask ?? []).map((rule) => sourced(rule, source))],
    deny: [...current.deny, ...(next.deny ?? []).map((rule) => sourced(rule, source))],
  }),
  hooks: (current, next, source) => {
    const merged = { ...current };
    for (const event of HOOK_EVENTS) {
      const groups: HookMatcherGroup[] | undefined = next[event];
      if (groups?.length) merged[event] = [...(merged[event] ?? []), ...groups.map((group) => sourced(group, source))];
    }
    return merged;
  },
  // Any file can turn hooks off; none can turn them back on for another.
  disableAllHooks: (current, next) => current || next === true,
  // An entry with neither command nor url only turns a server defined in an earlier file on or off here.
  mcpServers: (current, next, source) => {
    const merged = { ...current };
    for (const [name, server] of Object.entries(next) as [string, McpServerConfig][]) {
      if (!isMcpServerPatch(server)) merged[name] = sourced(server, source);
      else if (merged[name]) merged[name] = { value: { ...merged[name].value, ...server } as McpServerConfig, source: merged[name].source, override: source };
    }
    return merged;
  },
  automations: (current, next, source) => {
    const byId = new Map(current.map((entry) => [entry.value.id, entry]));
    for (const automation of next as AutomationConfig[]) byId.set(automation.id, sourced(automation, source));
    return [...byId.values()];
  },
  statusLine: replace(),
  theme: replace(),
  themeOverrides: byKey(),
  commandSources: byKey(),
  plugins: byKey(),
  style: replace(),
  personalInstructions: replace(),
  openWith: replace(),
};

export function emptyExtendedConfig(): EffectiveExtendedConfig {
  return {
    permissions: { allow: [], ask: [], deny: [] },
    hooks: {},
    disableAllHooks: false,
    mcpServers: {},
    automations: [],
    themeOverrides: {},
    commandSources: {},
    plugins: {},
    openWith: [],
  };
}

/** Merge validated layers over the defaults, in precedence order. */
export function mergeLayers(layers: readonly Layer[], defaults: CapsuleSettings): MergedConfig {
  const ordered = [...layers].sort((a, b) => PRECEDENCE[a.scope] - PRECEDENCE[b.scope]);
  const settings: Record<string, unknown> = { ...defaults };
  const extended = emptyExtendedConfig() as unknown as Record<string, unknown>;
  const provenance: Partial<Record<string, Provenance>> = {};
  for (const layer of ordered) {
    const source: Provenance = { scope: layer.scope, path: layer.path };
    for (const [key, value] of Object.entries(layer.values)) {
      provenance[key] = source;
      if (key in SETTINGS_SCHEMA) settings[key] = value;
      else {
        const merge = MERGERS[key as ExtendedConfigKey] as Merger<ExtendedConfigKey>;
        extended[key] = merge(extended[key] as never, value as never, source);
      }
    }
  }
  return {
    settings: normalizeCapsuleSettings(settings as Partial<CapsuleSettings>),
    extended: extended as unknown as EffectiveExtendedConfig,
    provenance,
  };
}

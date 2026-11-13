import type {
  ConfigKey,
  ExtendedConfig,
  ExtendedConfigKey,
  HookMatcherGroup,
  HooksConfig,
  McpServerConfig,
  PendingTrustItem,
  PermissionRules,
  StatusLineConfig,
} from "@capsule/shared";

/**
 * What a project file may do. A project is a folder someone else may have
 * written, so two rules apply on top of the key registry's `scope`:
 *
 * - Some parts of a key a project may set are still the user's alone, because
 *   they start a local process or talk to a server with the user's headers.
 * - Entries that run code or loosen a rule wait until the folder is trusted.
 *   Rules that only restrict apply at once.
 */

export interface Removed {
  at: string;
  message: string;
}

type Restriction<T> = (value: T, key: string) => { value: T | undefined; removed: Removed[] };
type Gate<T> = (value: T, path: string) => { applied?: T; held: PendingTrustItem[] };
type Value<K extends ExtendedConfigKey> = NonNullable<ExtendedConfig[K]>;

const USER_ONLY_PARTS: { [K in ExtendedConfigKey]?: Restriction<Value<K>> } = {
  statusLine: ((value: StatusLineConfig, key) => {
    if (value.command === undefined) return { value, removed: [] };
    const { command: _command, ...rest } = value;
    return { value: rest, removed: [{ at: `${key}.command`, message: "A status line command can only be set in your user settings." }] };
  }) satisfies Restriction<StatusLineConfig>,
  hooks: ((value: HooksConfig, key) => {
    const removed: Removed[] = [];
    const kept: HooksConfig = {};
    for (const [event, groups] of Object.entries(value) as [keyof HooksConfig, HookMatcherGroup[]][]) {
      kept[event] = groups.flatMap((group, index) => {
        const hooks = group.hooks.filter((handler, handlerIndex) => {
          if (handler.type !== "http") return true;
          removed.push({ at: `${key}.${event}[${index}].hooks[${handlerIndex}]`, message: "HTTP hooks can only be set in your user settings." });
          return false;
        });
        return hooks.length ? [{ ...group, hooks }] : [];
      });
    }
    return { value: kept, removed };
  }) satisfies Restriction<HooksConfig>,
  mcpServers: ((value: Record<string, McpServerConfig>, key) => {
    const removed: Removed[] = [];
    const kept: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(value)) {
      if ("command" in server || "env" in server) {
        removed.push({ at: `${key}.${name}`, message: "MCP servers that start a local command can only be set in your user settings." });
        continue;
      }
      kept[name] = server;
    }
    return { value: kept, removed };
  }) satisfies Restriction<Record<string, McpServerConfig>>,
};

/** Remove the parts of a key that only the user file may hold. */
export function restrictProjectValue(key: ConfigKey, value: unknown): { value: unknown; removed: Removed[] } {
  const restrict = USER_ONLY_PARTS[key as ExtendedConfigKey] as Restriction<unknown> | undefined;
  return restrict ? restrict(value, key) : { value, removed: [] };
}

const TRUST_GATES: { [K in ExtendedConfigKey]?: Gate<Value<K>> } = {
  permissions: ((value: PermissionRules, path) => {
    const applied: PermissionRules = {};
    if (value.deny?.length) applied.deny = value.deny;
    if (value.ask?.length) applied.ask = value.ask;
    return {
      applied: Object.keys(applied).length ? applied : undefined,
      held: (value.allow ?? []).map((rule) => ({ kind: "permission-allow", detail: rule, path })),
    };
  }) satisfies Gate<PermissionRules>,
  hooks: ((value: HooksConfig, path) => ({
    held: Object.entries(value).flatMap(([event, groups]) =>
      (groups ?? []).flatMap((group) =>
        group.hooks.map((handler) => ({
          kind: "hook" as const,
          detail: `${event}${group.matcher ? ` (${group.matcher})` : ""}: ${handler.type === "command" ? handler.command : handler.url}`,
          path,
        })))),
  })) satisfies Gate<HooksConfig>,
  mcpServers: ((value: Record<string, McpServerConfig>, path) => ({
    held: Object.entries(value).map(([name, server]) => ({
      kind: "mcp-server" as const,
      detail: `${name}: ${"url" in server ? server.url : server.command}`,
      path,
    })),
  })) satisfies Gate<Record<string, McpServerConfig>>,
  automations: ((value: Value<"automations">, path) => ({
    held: value.map((automation) => ({
      kind: "automation" as const,
      detail: `${automation.name}: ${automation.command ?? automation.prompt ?? ""}`.trim(),
      path,
    })),
  })) satisfies Gate<Value<"automations">>,
};

/**
 * Split a trust-gated value from an untrusted project into what applies now
 * and what waits. A key without its own gate waits whole.
 */
export function gateUntrusted(key: ConfigKey, value: unknown, path: string): { applied?: unknown; held: PendingTrustItem[] } {
  const gate = TRUST_GATES[key as ExtendedConfigKey] as Gate<unknown> | undefined;
  return gate ? gate(value, path) : { held: [{ kind: "hook", detail: key, path }] };
}

export function hasTrustGate(key: ConfigKey): boolean {
  return key in TRUST_GATES;
}

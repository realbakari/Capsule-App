import { asRecord, asString } from "./events.js";

export function looksLikeAcpx(value: string): boolean {
  return value.trim().toLowerCase().includes("acpx");
}

function namesFromUnknown(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = asRecord(entry);
      return asString(
        record.id,
        asString(record.pluginId, asString(record.packageName, asString(record.name))),
      );
    })
    .filter(Boolean);
}

function pluginEnabled(record: Record<string, unknown>): boolean {
  if (record.enabled === false) return false;
  const state = asString(record.state, "enabled").toLowerCase();
  return state !== "disabled" && state !== "not-installed" && state !== "error";
}

/** True when health.plugins.loaded includes acpx. Undefined if the payload has no plugin inventory. */
export function acpxFromHealth(payload: unknown): boolean | undefined {
  const plugins = asRecord(asRecord(payload).plugins);
  if (!("loaded" in plugins) && !("errors" in plugins) && !Array.isArray(asRecord(payload).plugins)) {
    return undefined;
  }
  const loaded = namesFromUnknown(plugins.loaded ?? asRecord(payload).plugins);
  const errors = namesFromUnknown(plugins.errors);
  if (loaded.some(looksLikeAcpx)) return true;
  if (errors.some(looksLikeAcpx)) return false;
  if ("loaded" in plugins || Array.isArray(asRecord(payload).plugins)) return false;
  return undefined;
}

function configRoots(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  return ["config", "parsed", "resolved", "runtimeConfig", "sourceConfig"]
    .map((key) => asRecord(root[key]))
    .filter((entry) => Object.keys(entry).length > 0)
    .concat(root);
}

function pluginEntriesFromConfig(payload: unknown): Record<string, unknown> | undefined {
  for (const root of configRoots(payload)) {
    const plugins = asRecord(root.plugins);
    const entries = asRecord(plugins.entries);
    if (Object.keys(entries).length > 0) return entries;
    if (plugins.entries && typeof plugins.entries === "object") return entries;
  }
  return undefined;
}

/** True when Gateway config has plugins.entries.acpx.enabled. Undefined if no plugin entries exist. */
export function acpxFromConfig(payload: unknown): boolean | undefined {
  const entries = pluginEntriesFromConfig(payload);
  if (!entries) return undefined;
  const match = Object.entries(entries).find(([id]) => looksLikeAcpx(id));
  if (!match) return false;
  return pluginEnabled(asRecord(match[1]));
}

/** True when plugins.list includes an enabled acpx row. Undefined if the payload is not a plugin list. */
export function acpxFromPluginsList(payload: unknown): boolean | undefined {
  const root = asRecord(payload);
  const rows = root.plugins ?? root.entries ?? root.items;
  if (!Array.isArray(rows)) return undefined;
  const match = rows.find((row) => {
    const record = asRecord(row);
    const id = `${asString(record.id)}${asString(record.pluginId)}${asString(record.packageName)}${asString(record.name)}`;
    return looksLikeAcpx(id);
  });
  if (!match) return false;
  return pluginEnabled(asRecord(match));
}

export function resolveAcpxEnabled(input: {
  health?: unknown;
  config?: unknown;
  pluginsList?: unknown;
}): boolean {
  const loaded = input.health === undefined ? undefined : acpxFromHealth(input.health);
  if (loaded === true) return true;
  const listed = input.pluginsList === undefined ? undefined : acpxFromPluginsList(input.pluginsList);
  if (listed === true) return true;
  const configured = input.config === undefined ? undefined : acpxFromConfig(input.config);
  if (configured === true) return true;
  return false;
}

export interface AcpxHarnessPolicy {
  pluginId?: string;
  permissionMode?: string;
  nonInteractivePermissions?: string;
}

export interface AcpxAgentCommand {
  command: string;
  args?: string[];
}

export interface ConfiguredAcpxAgent extends AcpxAgentCommand {
  pluginId?: string;
}

function pluginConfigRecord(entry: Record<string, unknown>): Record<string, unknown> {
  return asRecord(entry.config);
}

/** Reads plugins.entries.acpx.config permission keys from a config.get payload. */
export function readAcpxHarnessPolicy(payload: unknown): AcpxHarnessPolicy {
  const entries = pluginEntriesFromConfig(payload);
  if (!entries) return {};
  const match = Object.entries(entries).find(([id]) => looksLikeAcpx(id));
  if (!match) return {};
  const config = pluginConfigRecord(asRecord(match[1]));
  return {
    pluginId: match[0],
    permissionMode: asString(config.permissionMode) || undefined,
    nonInteractivePermissions: asString(config.nonInteractivePermissions) || undefined,
  };
}

/** Reads a custom plugins.entries.acpx.config.agents.<id> command mapping. */
export function readAcpxAgentCommand(
  payload: unknown,
  agentId: string,
): ConfiguredAcpxAgent | undefined {
  const entries = pluginEntriesFromConfig(payload);
  if (!entries) return undefined;
  const match = Object.entries(entries).find(([id]) => looksLikeAcpx(id));
  if (!match) return undefined;
  const agent = asRecord(asRecord(pluginConfigRecord(asRecord(match[1])).agents)[agentId]);
  const command = asString(agent.command);
  if (!command) return undefined;
  const args = Array.isArray(agent.args)
    ? agent.args.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    pluginId: match[0],
    command,
    ...(args ? { args } : {}),
  };
}

/** Undefined means OpenClaw is using its default (unrestricted) ACP allowlist. */
export function readAcpAllowedAgents(payload: unknown): string[] | undefined {
  for (const root of configRoots(payload)) {
    const acp = asRecord(root.acp);
    if (!("allowedAgents" in acp)) continue;
    if (!Array.isArray(acp.allowedAgents)) return undefined;
    return acp.allowedAgents.filter((value): value is string => typeof value === "string");
  }
  return undefined;
}

/** Deep-merge patch for a native ACP command that acpx does not ship itself. */
export function acpxAgentPatch(
  pluginId: string,
  agentId: string,
  definition: AcpxAgentCommand,
  allowedAgents?: string[],
): Record<string, unknown> {
  return {
    plugins: {
      entries: {
        [pluginId]: {
          enabled: true,
          config: {
            agents: {
              [agentId]: {
                command: definition.command,
                ...(definition.args ? { args: definition.args } : {}),
              },
            },
          },
        },
      },
    },
    ...(allowedAgents
      ? { acp: { allowedAgents: [...new Set([...allowedAgents, agentId])] } }
      : {}),
  };
}

/** Standard/Full access need this; approve-reads still dies on the first write. */
export function acpxPolicyAllowsHeadlessWrites(policy: AcpxHarnessPolicy): boolean {
  return policy.permissionMode === "approve-all";
}

/** Both ends of acpx's scale are non-fatal. The default (approve-reads) is not. */
export function acpxModeIsNonFatal(mode: string | undefined): boolean {
  return mode === "approve-all" || mode === "deny-all";
}

export function acpxPermissionPatch(
  pluginId = "acpx",
  mode: "approve-all" | "deny-all",
): Record<string, unknown> {
  return {
    plugins: {
      entries: {
        [pluginId]: {
          enabled: true,
          config: {
            permissionMode: mode,
            // If a prompt still happens, refuse the tool instead of aborting the turn.
            nonInteractivePermissions: "deny",
          },
        },
      },
    },
  };
}

export function acpxHeadlessWritesPatch(pluginId = "acpx"): Record<string, unknown> {
  return acpxPermissionPatch(pluginId, "approve-all");
}

/**
 * ACP session/request_permission (and close cousins) when OpenClaw forwards
 * them to the operator socket. exec.approval.requested is handled separately.
 */
export function isAcpPermissionRequestEvent(
  eventName: string | undefined,
  payload: Record<string, unknown>,
): boolean {
  const name = (eventName ?? "").toLowerCase();
  if (name === "exec.approval.requested" || name === "plugin.approval.requested") return false;
  if (name.includes("permission") && name.includes("request")) return true;
  const method = asString(payload.method, asString(asRecord(payload.params).method)).toLowerCase();
  if (method === "session/request_permission" || method.endsWith("request_permission")) return true;
  const type = asString(payload.type, asString(payload.kind)).toLowerCase();
  if (type.includes("permission") && type.includes("request")) return true;
  const params = asRecord(payload.params);
  const toolCall = asRecord(params.toolCall ?? payload.toolCall);
  return Boolean(toolCall.kind || toolCall.title) && Array.isArray(params.options);
}

/** Fields Capsule Approvals needs from an ACP permission RPC or Gateway approval event. */
export function readAcpPermissionRequest(payload: Record<string, unknown>): {
  id?: string;
  tool?: string;
  title?: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  action?: string;
} {
  const params = asRecord(payload.params);
  const toolCall = asRecord(params.toolCall ?? payload.toolCall);
  const id =
    asString(payload.id) ||
    asString(payload.requestId) ||
    asString(payload.request_id) ||
    asString(params.requestId) ||
    asString(params.id);
  const tool = asString(toolCall.kind, asString(toolCall.title, asString(payload.tool)));
  const title = asString(toolCall.title, asString(payload.title, asString(params.title)));
  const sessionKey =
    asString(payload.sessionKey) ||
    asString(payload.key) ||
    asString(params.sessionId) ||
    asString(payload.sessionId);
  const runId = asString(payload.runId, asString(params.runId));
  const agentId = asString(payload.agentId, asString(params.agentId));
  const action = asString(payload.action, asString(payload.command, tool || title));
  return {
    id: id || undefined,
    tool: tool || undefined,
    title: title || undefined,
    sessionKey: sessionKey || undefined,
    runId: runId || undefined,
    agentId: agentId || undefined,
    action: action || undefined,
  };
}

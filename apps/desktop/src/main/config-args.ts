import { IpcArgumentError, type ArgParser } from "@capsule/contracts";
import { type PluginOptionValue, type PluginsConfigureInput, type PluginsInspectInput, type PluginsInstallInput, AUTOMATION_TEMPLATES, type AutomationCreateInput, type AutomationEnabledInput, type AutomationKeyInput, type StatusLineRequest, KEYMAP_CONTEXTS, MAX_THEME_SHARE_BYTES, WRITABLE_SCOPES, type CommandExpandInput, type ConfigFileTarget, type McpEnabledInput, type McpTestInput, type ProfileCreateInput, type KeybindingEdit, type KeymapContext, type PermissionRuleEdit, type SetConfigValueInput, type ThemeImportInput, type WritableScope } from "@capsule/shared";

/*
 * Shapes for the settings-file channels, checked where they cross from the
 * renderer. The value itself is checked against the key registry by the
 * config service, which knows each key's schema.
 */

const FOLDERS = ["commands", "profiles", "styles", "themes", "plugins"] as const;

export const setConfigValueInput: ArgParser<SetConfigValueInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.key !== "string" || !input.key.trim()) throw new IpcArgumentError(channel, index, "needs a key");
  return {
    key: input.key,
    scope: scope(input.scope, channel, index),
    ...(input.value === undefined ? {} : { value: input.value }),
    ...projectId(input.projectId, channel, index),
  };
};

export const configFileTarget: ArgParser<ConfigFileTarget> = (value, channel, index) => {
  const input = record(value, channel, index);
  switch (input.kind) {
    case "settings":
      return { kind: "settings", scope: scope(input.scope, channel, index), ...projectId(input.projectId, channel, index) };
    case "keybindings":
      return { kind: "keybindings" };
    case "folder": {
      const folder = FOLDERS.find((item) => item === input.folder);
      if (!folder) throw new IpcArgumentError(channel, index, `folder must be one of ${FOLDERS.join(", ")}`);
      if (input.scope !== "user" && input.scope !== "project") throw new IpcArgumentError(channel, index, "scope must be user or project");
      return { kind: "folder", folder, scope: input.scope, ...projectId(input.projectId, channel, index) };
    }
    case "resource": {
      if (input.folder !== "profiles" && input.folder !== "styles") throw new IpcArgumentError(channel, index, "folder must be profiles or styles");
      if (input.scope !== "user" && input.scope !== "project") throw new IpcArgumentError(channel, index, "scope must be user or project");
      if (typeof input.name !== "string" || !/^[a-z0-9][a-z0-9:_-]*$/.test(input.name)) throw new IpcArgumentError(channel, index, "name must be a profile or style id");
      return { kind: "resource", folder: input.folder, scope: input.scope, name: input.name, ...projectId(input.projectId, channel, index) };
    }
    default:
      throw new IpcArgumentError(channel, index, "kind must be settings, keybindings, folder or resource");
  }
};

const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const mcpTestInput: ArgParser<McpTestInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.name !== "string" || !MCP_NAME.test(input.name)) throw new IpcArgumentError(channel, index, "name must be an MCP server name");
  return { name: input.name, ...projectId(input.projectId, channel, index) };
};

export const mcpEnabledInput: ArgParser<McpEnabledInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.name !== "string" || !MCP_NAME.test(input.name)) throw new IpcArgumentError(channel, index, "name must be an MCP server name");
  if (typeof input.enabled !== "boolean") throw new IpcArgumentError(channel, index, "enabled must be true or false");
  if (input.where !== "everywhere" && input.where !== "project") throw new IpcArgumentError(channel, index, "where must be everywhere or project");
  if (input.where === "project" && input.projectId === undefined) throw new IpcArgumentError(channel, index, "a project switch needs a projectId");
  return { name: input.name, enabled: input.enabled, where: input.where, ...projectId(input.projectId, channel, index) };
};

export const profileCreateInput: ArgParser<ProfileCreateInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (input.scope !== "user" && input.scope !== "project") throw new IpcArgumentError(channel, index, "scope must be user or project");
  if (input.scope === "project" && input.projectId === undefined) throw new IpcArgumentError(channel, index, "a project profile needs a projectId");
  if (input.from !== undefined && (typeof input.from !== "string" || !/^[a-z0-9][a-z0-9:_-]*$/.test(input.from))) throw new IpcArgumentError(channel, index, "from must be a profile id");
  return { scope: input.scope, ...projectId(input.projectId, channel, index), ...(input.from === undefined ? {} : { from: input.from }) };
};

const AUTOMATION_KEY = /^[A-Za-z0-9_-]{1,80}:[a-z0-9][a-z0-9-]{0,80}$/;

export const automationKeyInput: ArgParser<AutomationKeyInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.key !== "string" || !AUTOMATION_KEY.test(input.key)) throw new IpcArgumentError(channel, index, "key must name an automation");
  return { key: input.key, ...projectId(input.projectId, channel, index) };
};

export const automationEnabledInput: ArgParser<AutomationEnabledInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.enabled !== "boolean") throw new IpcArgumentError(channel, index, "enabled must be true or false");
  return { ...automationKeyInput(value, channel, index), enabled: input.enabled };
};

export const automationCreateInput: ArgParser<AutomationCreateInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (!AUTOMATION_TEMPLATES.some((template) => template.id === input.template)) throw new IpcArgumentError(channel, index, "template must be a known automation template");
  if (input.scope !== "user" && input.scope !== "local") throw new IpcArgumentError(channel, index, "scope must be user or local");
  if (input.scope === "local" && input.projectId === undefined) throw new IpcArgumentError(channel, index, "a project automation needs a projectId");
  return { template: input.template as string, scope: input.scope, ...projectId(input.projectId, channel, index) };
};

/** The facts stay unknown here; the engine keeps only the fields it knows. */
export const statusLineRequest: ArgParser<StatusLineRequest> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.projectId !== "string" || !input.projectId.trim()) throw new IpcArgumentError(channel, index, "needs a projectId");
  if (input.sessionId !== undefined && (typeof input.sessionId !== "string" || !input.sessionId.trim())) throw new IpcArgumentError(channel, index, "sessionId must be a string");
  return { projectId: input.projectId, ...(input.sessionId ? { sessionId: input.sessionId as string } : {}), facts: input.facts as StatusLineRequest["facts"] };
};

export const commandExpandInput: ArgParser<CommandExpandInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.projectId !== "string" || !input.projectId.trim()) throw new IpcArgumentError(channel, index, "needs a projectId");
  if (typeof input.text !== "string" || !input.text.trim().startsWith("/") || input.text.length > 20_000) {
    throw new IpcArgumentError(channel, index, "text must be a /command of at most 20,000 characters");
  }
  if (input.sessionId !== undefined && (typeof input.sessionId !== "string" || !input.sessionId.trim())) {
    throw new IpcArgumentError(channel, index, "sessionId must be a non-empty string");
  }
  return { projectId: input.projectId, text: input.text, ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }) };
};

/** The rule's own syntax is checked by the config service, which names what is wrong. */
export const permissionRuleEdit: ArgParser<PermissionRuleEdit> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (input.op !== "add" && input.op !== "remove") throw new IpcArgumentError(channel, index, "op must be add or remove");
  if (input.list !== "allow" && input.list !== "ask" && input.list !== "deny") throw new IpcArgumentError(channel, index, "list must be allow, ask or deny");
  if (input.scope !== "user" && input.scope !== "local") throw new IpcArgumentError(channel, index, "scope must be user or local");
  if (typeof input.rule !== "string" || !input.rule.trim() || input.rule.length > 4096) throw new IpcArgumentError(channel, index, "rule must be text of at most 4,096 characters");
  if (input.scope === "local" && input.projectId === undefined) throw new IpcArgumentError(channel, index, "a local rule needs a projectId");
  return { op: input.op, list: input.list, scope: input.scope, rule: input.rule, ...projectId(input.projectId, channel, index) };
};

export const appRestartInput: ArgParser<{ safeMode: boolean }> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.safeMode !== "boolean") throw new IpcArgumentError(channel, index, "safeMode must be true or false");
  return { safeMode: input.safeMode };
};

/** The sequence's own syntax is checked by the config service, which names what is wrong. */
export const keybindingEdit: ArgParser<KeybindingEdit> = (value, channel, index) => {
  const input = record(value, channel, index);
  const context = KEYMAP_CONTEXTS.find((item) => item === input.context) as KeymapContext | undefined;
  if (!context) throw new IpcArgumentError(channel, index, `context must be one of ${KEYMAP_CONTEXTS.join(", ")}`);
  const text = (field: "action" | "sequence") => {
    const raw = input[field];
    if (typeof raw !== "string" || !raw.trim() || raw.length > 200) throw new IpcArgumentError(channel, index, `${field} must be text of at most 200 characters`);
    return raw;
  };
  switch (input.op) {
    case "bind":
      return { op: "bind", action: text("action"), context, sequence: text("sequence") };
    case "unbind":
      return { op: "unbind", context, sequence: text("sequence") };
    case "reset":
      return { op: "reset", action: text("action"), context };
    default:
      throw new IpcArgumentError(channel, index, "op must be bind, unbind or reset");
  }
};

export const themeImportInput: ArgParser<ThemeImportInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (input.from === "file") return { from: "file" };
  if (input.from !== "share") throw new IpcArgumentError(channel, index, "from must be share or file");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > MAX_THEME_SHARE_BYTES) {
    throw new IpcArgumentError(channel, index, "text must be a share string of at most 32 KB");
  }
  return { from: "share", text: input.text };
};

const PLUGIN_SOURCES = ["folder", "zip", "git", "dev"] as const;
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const pluginsInspectInput: ArgParser<PluginsInspectInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  const from = PLUGIN_SOURCES.find((item) => item === input.from);
  if (!from) throw new IpcArgumentError(channel, index, `from must be one of ${PLUGIN_SOURCES.join(", ")}`);
  if (from !== "git") return { from };
  if (typeof input.url !== "string" || !input.url.trim() || input.url.length > 2048) throw new IpcArgumentError(channel, index, "url must be a repository address");
  return { from, url: input.url.trim() };
};

export const pluginToken: ArgParser<string> = (value, channel, index) => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new IpcArgumentError(channel, index, "must be an install token");
  return value;
};

export const pluginName: ArgParser<string> = (value, channel, index) => {
  if (typeof value !== "string" || !PLUGIN_NAME.test(value)) throw new IpcArgumentError(channel, index, "must be a plugin name");
  return value;
};

function pluginValues(value: unknown, channel: string, index: number, allowNull: boolean): Record<string, PluginOptionValue | null> | undefined {
  if (value === undefined) return undefined;
  const input = record(value, channel, index);
  const out: Record<string, PluginOptionValue | null> = {};
  for (const [key, item] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw new IpcArgumentError(channel, index, "option names are letters, digits and _");
    if (item === null && allowNull) out[key] = null;
    else if (typeof item === "string" ? item.length <= 8192 : typeof item === "number" || typeof item === "boolean") out[key] = item as PluginOptionValue;
    else throw new IpcArgumentError(channel, index, "values must be text, numbers or true/false");
  }
  return out;
}

export const pluginsInstallInput: ArgParser<PluginsInstallInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  const values = pluginValues(input.values, channel, index, false) as Record<string, PluginOptionValue> | undefined;
  return { token: pluginToken(input.token, channel, index), ...(values ? { values } : {}) };
};

export const pluginsEnabledInput: ArgParser<{ name: string; enabled: boolean }> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (typeof input.enabled !== "boolean") throw new IpcArgumentError(channel, index, "enabled must be true or false");
  return { name: pluginName(input.name, channel, index), enabled: input.enabled };
};

export const pluginsConfigureInput: ArgParser<PluginsConfigureInput> = (value, channel, index) => {
  const input = record(value, channel, index);
  if (input.mayApprove !== undefined && typeof input.mayApprove !== "boolean") throw new IpcArgumentError(channel, index, "mayApprove must be true or false");
  const values = pluginValues(input.values, channel, index, true);
  return { name: pluginName(input.name, channel, index), ...(values ? { values } : {}), ...(typeof input.mayApprove === "boolean" ? { mayApprove: input.mayApprove } : {}) };
};

function record(value: unknown, channel: string, index: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IpcArgumentError(channel, index, "must be an object");
  return value as Record<string, unknown>;
}

function scope(value: unknown, channel: string, index: number): WritableScope {
  const found = WRITABLE_SCOPES.find((item) => item === value);
  if (!found) throw new IpcArgumentError(channel, index, `scope must be one of ${WRITABLE_SCOPES.join(", ")}`);
  return found;
}

function projectId(value: unknown, channel: string, index: number): { projectId?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" || !value.trim()) throw new IpcArgumentError(channel, index, "projectId must be a non-empty string");
  return { projectId: value };
}

import { IpcArgumentError, type ArgParser } from "@capsule/contracts";
import { KEYMAP_CONTEXTS, MAX_THEME_SHARE_BYTES, WRITABLE_SCOPES, type CommandExpandInput, type ConfigFileTarget, type KeybindingEdit, type KeymapContext, type PermissionRuleEdit, type SetConfigValueInput, type ThemeImportInput, type WritableScope } from "@capsule/shared";

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
    default:
      throw new IpcArgumentError(channel, index, "kind must be settings, keybindings or folder");
  }
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

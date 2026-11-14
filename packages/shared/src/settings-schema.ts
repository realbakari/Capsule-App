import { BACKDROP_JSON_SCHEMA } from "./backdrop.js";
import { HOOK_EVENTS, STATUS_LINE_ITEMS, type ExtendedConfigKey, type FileSettingKey } from "./config.js";
import { LONG_COMMAND_SECONDS, SETTINGS_SECTION_KEYS } from "./runtime.js";

/** A JSON Schema fragment. Kept loose: it is data for editors and for validation. */
export type JsonSchema = Record<string, unknown>;

export interface SettingSpec {
  /**
   * `user`: only `~/.capsule/settings.json` may set it. A project file that
   * sets it gets a warning and is ignored. `both`: project files may set it.
   */
  scope: "user" | "both";
  /** `live` applies at once. `next-thread` applies to threads started after the change. */
  apply: "live" | "next-thread";
  description: string;
  schema: JsonSchema;
  /**
   * A project file's value only applies after the folder is trusted, because
   * it runs code or loosens a rule.
   */
  needsTrust?: boolean;
}

const bool = (description: string, scope: SettingSpec["scope"] = "user", apply: SettingSpec["apply"] = "live"): SettingSpec =>
  ({ scope, apply, description, schema: { type: "boolean" } });
const oneOf = (values: readonly string[], description: string, scope: SettingSpec["scope"] = "user", apply: SettingSpec["apply"] = "live"): SettingSpec =>
  ({ scope, apply, description, schema: { type: "string", enum: [...values] } });
const text = (description: string, scope: SettingSpec["scope"] = "user", apply: SettingSpec["apply"] = "live", extra: JsonSchema = {}): SettingSpec =>
  ({ scope, apply, description, schema: { type: "string", ...extra } });

const palette: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    accent: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
    background: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
    foreground: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
    contrast: { type: "number", minimum: 0, maximum: 100 },
    translucentSidebar: { type: "boolean" },
    uiFont: { enum: ["system", "rounded", "serif"] },
    codeFont: { enum: ["sf-mono", "menlo", "jetbrains"] },
  },
};

const stringMap: JsonSchema = { type: "object", additionalProperties: { type: "string" } };
const stringList: JsonSchema = { type: "array", items: { type: "string" } };

/**
 * Every preference a settings file can hold, declared once. Validation,
 * provenance, Reset and the published JSON Schema all read this table.
 */
export const SETTINGS_SCHEMA: Record<FileSettingKey, SettingSpec> = {
  gatewayUrl: text("Address of the OpenClaw Gateway.", "user", "live", { format: "uri" }),
  runtimeMode: oneOf(["auto", "openclaw", "direct"], "Who carries a coding turn: the Gateway, Capsule directly, or whichever is available."),
  launchAtLogin: bool("Open Capsule when you log in."),
  composerSendKey: oneOf(["enter", "cmd-enter"], "Which key sends a prompt."),
  defaultMode: oneOf(["chat", "agent", "plan", "code", "research", "browser", "automation"], "Mode for new conversations.", "both", "next-thread"),
  defaultWorkspaceMode: oneOf(["local", "worktree"], "Where new conversations in a Git project run.", "both", "next-thread"),
  defaultPermission: oneOf(["default", "strict", "approve-all"], "Permission profile for new conversations.", "both", "next-thread"),
  defaultAgentId: text("Agent for new conversations.", "both", "next-thread"),
  projectlessFolder: text("Folder for conversations started outside a project."),
  remoteAccess: oneOf(["off", "loopback", "network"], "Who may read this Capsule from another device."),
  analyticsEnabled: bool("Send anonymous usage reports."),
  appearanceTheme: oneOf(["system", "dark", "light"], "Light, dark, or follow the system."),
  appearanceLight: { scope: "user", apply: "live", description: "Colours and fonts for the light appearance.", schema: palette },
  appearanceDark: { scope: "user", apply: "live", description: "Colours and fonts for the dark appearance.", schema: palette },
  webAccess: oneOf(["off", "ask", "on"], "Whether agents may search and fetch the web.", "both", "next-thread"),
  sandbox: oneOf(["off", "ask", "strict"], "How freely agents may run commands.", "both", "next-thread"),
  outputDetail: oneOf(["concise", "standard", "verbose"], "How much an agent's replies include.", "both"),
  reasoningSummary: oneOf(["hidden", "collapsed", "visible"], "How reasoning is shown in a turn.", "both"),
  transcriptSize: oneOf(["s", "m", "l"], "Text size in conversations."),
  transcriptWidth: oneOf(["narrow", "standard", "wide"], "Width of the conversation column."),
  customCodeFont: text("A font family put first in the code font stack.", "user", "live", { maxLength: 80 }),
  notifyRunComplete: bool("Notify when a turn finishes."),
  notifyApprovals: bool("Notify when an agent asks for approval."),
  agentSimulatorAccess: bool("Let direct agents use a simulator attached in the thread's panel."),
  autoResumeOnLimit: bool("Resume a turn stopped by a usage limit when the limit resets."),
  bounceDockOnAttention: bool("Bounce the Dock icon when a conversation needs you."),
  showMenuBarExtra: bool("Show Capsule in the menu bar."),
  keepAwakeWhileRunning: bool("Keep the Mac awake while a turn runs."),
  autoDownloadUpdates: bool("Download updates in the background."),
  autoClassifySessions: bool("Mark conversations as blocked or done from their last turn."),
  archiveInactiveAfter: oneOf(["never", "1d", "7d", "30d"], "Archive conversations left alone this long."),
  branchPrefix: text("Prefix for branches Capsule creates.", "both"),
  worktreesDirectory: text("Folder for new worktrees. Empty uses Capsule's own."),
  gitForceWithLease: bool("Ask agents to push with --force-with-lease.", "both"),
  prDraft: bool("Ask agents to open pull requests as drafts.", "both"),
  prMergeMethod: oneOf(["merge", "squash", "rebase"], "How pull requests are merged.", "both"),
  prReviewDelivery: oneOf(["current", "new-chat"], "Where a pull request review lands.", "both"),
  prWatchAndFix: bool("Watch an open pull request and fix failing checks.", "both"),
  prAutoMerge: bool("Merge a watched pull request when it is green.", "both"),
  prWatchUntilMerged: bool("Keep watching a pull request until it merges.", "both"),
  commitInstructions: text("Guidance for commit messages, sent to agents.", "both", "live", { maxLength: 2000 }),
  prInstructions: text("Guidance for pull request titles and descriptions.", "both", "live", { maxLength: 2000 }),
  keybindings: { scope: "user", apply: "live", description: "Superseded by keybindings.json. Read once and moved there.", schema: stringMap },
  timeFormat: oneOf(["system", "12h", "24h"], "Clock style for message times."),
  confirmDelete: bool("Ask before deleting a conversation or project."),
  confirmArchive: bool("Ask before archiving a conversation."),
  toolCallDisplay: oneOf(["compact", "expanded"], "How a turn's tool calls first appear.", "both"),
  followUpBehavior: oneOf(["queue", "steer"], "What sending during a running turn does."),
  diffLayout: oneOf(["split", "unified"], "Diff layout.", "both"),
  diffFileState: oneOf(["expanded", "collapsed"], "Whether files in a diff start open.", "both"),
  diffIgnoreWhitespace: bool("Review starts with whitespace-only changes hidden.", "both"),
  notifyLongCommands: bool("Notify when a command an agent ran without asking runs long."),
  longCommandSeconds: { scope: "user", apply: "live", description: "Seconds before a command counts as running long.", schema: { type: "number", enum: [...LONG_COMMAND_SECONDS] } },
  dockBadge: bool("Count conversations waiting on you on the Dock icon."),
  notificationSound: bool("Play the system sound with notifications."),
  continueAfterRestart: bool("After a quit or crash mid-turn, send that turn's prompt again."),
  followAgent: bool("While a turn runs, Files previews the file the agent is reading or editing."),
  autoSettleMerged: bool("Settle a conversation once the pull request it watches merges.", "both"),
  startInPlanMode: bool("New conversations begin in Plan.", "both", "next-thread"),
  modeModels: {
    scope: "both",
    apply: "next-thread",
    description: "Per agent, the model a switch to Plan or Act selects.",
    schema: { type: "object", additionalProperties: { type: "object", additionalProperties: false, properties: { plan: { type: "string" }, act: { type: "string" } } } },
  },
  favoriteModels: { scope: "user", apply: "live", description: "Starred models, as JSON [agent, model] keys, in the order they were starred.", schema: stringList },
  composerPrompts: {
    scope: "user",
    apply: "live",
    description: "Your saved prompts for the composer's / menu.",
    schema: { type: "array", items: { type: "object", required: ["name", "prompt"], properties: { name: { type: "string" }, prompt: { type: "string" }, description: { type: "string" } } } },
  },
  openInApps: { scope: "user", apply: "live", description: "Apps you added to Open in, by location on disk.", schema: stringList },
  openInHidden: { scope: "user", apply: "live", description: "Apps you removed from Open in.", schema: stringList },
  openInFavorite: text("The app Open in uses first."),
  agentTaskAutoStart: { scope: "user", apply: "live", description: "Projects whose agents may start the board tasks they create.", schema: stringList },
};

const commandOrHttp: JsonSchema = {
  oneOf: [
    { type: "object", required: ["type", "command"], properties: { type: { const: "command" }, command: { type: "string" }, timeout: { type: "number", minimum: 1 } } },
    { type: "object", required: ["type", "url"], properties: { type: { const: "http" }, url: { type: "string", format: "uri" }, headers: stringMap, timeout: { type: "number", minimum: 1 } } },
  ],
};

const ruleList: JsonSchema = { type: "array", items: { type: "string", pattern: "^[a-z]+(\\(.*\\))?$" } };

export const EXTENDED_SCHEMA: Record<ExtendedConfigKey, SettingSpec> = {
  permissions: {
    scope: "both",
    apply: "live",
    needsTrust: true,
    description: "Rules that answer agents' permission requests. deny wins over ask, ask over allow.",
    schema: { type: "object", additionalProperties: false, properties: { allow: ruleList, ask: ruleList, deny: ruleList } },
  },
  hooks: {
    scope: "both",
    apply: "live",
    needsTrust: true,
    description: "Commands Capsule runs at PromptSubmit, PermissionRequest, ToolCall and TurnEnd.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(HOOK_EVENTS.map((event) => [event, {
        type: "array",
        items: { type: "object", required: ["hooks"], properties: { matcher: { type: "string" }, hooks: { type: "array", items: commandOrHttp } } },
      }])),
    },
  },
  disableAllHooks: bool("Turn every hook off without deleting it.", "both"),
  mcpServers: {
    scope: "both",
    apply: "next-thread",
    needsTrust: true,
    description: "MCP servers offered to every direct conversation.",
    schema: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          command: { type: "string" }, args: { type: "array", items: { type: "string" } }, env: stringMap, cwd: { type: "string" },
          url: { type: "string", format: "uri" }, headers: stringMap, enabled: { type: "boolean" }, projects: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  statusLine: {
    scope: "both",
    apply: "live",
    description: "What the status line under the composer shows.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: { type: "array", items: { enum: [...STATUS_LINE_ITEMS] } },
        command: { type: "string" },
        refreshInterval: { type: "number", minimum: 1 },
      },
    },
  },
  theme: {
    scope: "user",
    apply: "live",
    description: "Theme ids for the light and dark appearances, and a backdrop that overrides the theme's.",
    schema: { type: "object", additionalProperties: false, properties: { light: { type: "string" }, dark: { type: "string" }, backdrop: BACKDROP_JSON_SCHEMA } },
  },
  themeOverrides: {
    scope: "user",
    apply: "live",
    description: "Token values that patch a theme, keyed by theme id.",
    schema: { type: "object", additionalProperties: stringMap },
  },
  automations: {
    scope: "both",
    apply: "live",
    needsTrust: true,
    description: "Prompts or commands Capsule runs on a schedule. Results land in the Inbox.",
    schema: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "schedule"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" }, name: { type: "string" }, schedule: { type: "string", pattern: "^RRULE:" },
          prompt: { type: "string" }, command: { type: "string" }, profile: { type: "string" },
          workspace: { enum: ["local", "worktree"] }, enabled: { type: "boolean" },
        },
      },
    },
  },
  commandSources: {
    scope: "user",
    apply: "live",
    description: "Other tools' command and skill folders, read as Markdown only.",
    schema: { type: "object", additionalProperties: false, properties: { "claude-commands": { type: "boolean" }, "claude-skills": { type: "boolean" }, "codex-prompts": { type: "boolean" } } },
  },
  plugins: {
    scope: "user",
    apply: "live",
    description: "Installed plugins: whether each is on, whether its hooks may approve requests, and folders loaded for development.",
    schema: { type: "object", additionalProperties: { type: "object", properties: { enabled: { type: "boolean" }, mayApprove: { type: "boolean" }, path: { type: "string" } } } },
  },
  style: text("Response style id sent with the first turn of each conversation.", "both", "next-thread"),
  personalInstructions: text("A Markdown file of standing instructions sent to every agent.", "user", "next-thread"),
  openWith: {
    scope: "user",
    apply: "live",
    description: "Your own Open with entries for files.",
    schema: {
      type: "array",
      items: { type: "object", required: ["id", "label", "command"], properties: { id: { type: "string" }, label: { type: "string" }, command: { type: "string" }, args: { type: "array", items: { type: "string" } } } },
    },
  },
};

export type ConfigKey = FileSettingKey | ExtendedConfigKey;

export function settingSpec(key: string): SettingSpec | undefined {
  return (SETTINGS_SCHEMA as Record<string, SettingSpec>)[key] ?? (EXTENDED_SCHEMA as Record<string, SettingSpec>)[key];
}

/** The Settings section a key belongs to, for "Open in file" and Reset. */
export function settingSection(key: string): string | undefined {
  for (const [section, keys] of Object.entries(SETTINGS_SECTION_KEYS)) {
    if ((keys as readonly string[]).includes(key)) return section;
  }
  return undefined;
}

/** The whole settings file as one JSON Schema document. */
export function settingsJsonSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = { $schema: { type: "string" } };
  for (const [key, spec] of [...Object.entries(SETTINGS_SCHEMA), ...Object.entries(EXTENDED_SCHEMA)]) {
    const scopeNote = spec.scope === "user" ? " User settings only." : "";
    properties[key] = { ...spec.schema, description: `${spec.description}${scopeNote}` };
  }
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Capsule settings",
    type: "object",
    additionalProperties: false,
    properties,
  };
}

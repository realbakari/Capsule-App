import type { FileSettingKey } from "@capsule/shared";

/**
 * The searchable catalog of settings.
 *
 * Settings are spread over ten sections; without search, finding one means
 * remembering which section it lives in. This catalog is the single source of
 * truth for a setting's title and the section it sits in, so a retitle happens
 * here once rather than drifting between the panel and the index.
 *
 * Keeping it as data also makes it testable: a title that no longer appears in
 * any panel is a stale entry, and a search result that lands on a section that
 * does not exist is a broken one.
 */

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "agents"
  | "gateway"
  | "projects"
  | "sourceControl"
  | "skills"
  | "shortcuts"
  | "diagnostics"
  | "about";

export interface SettingsSearchItem {
  /** What the row is called in its panel. */
  title: string;
  section: SettingsSectionId;
  /** Words a user might search that are not in the title. */
  keywords?: string[];
  /** The settings-file key the row edits, which its panel passes as `setting`. */
  key?: FileSettingKey;
}

export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: "General",
  appearance: "Appearance",
  agents: "Agents",
  gateway: "Gateway",
  projects: "Projects",
  sourceControl: "Source control",
  skills: "Skills",
  shortcuts: "Shortcuts",
  diagnostics: "Diagnostics",
  about: "About",
};

export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  { title: "Worktree location", section: "sourceControl", key: "worktreesDirectory", keywords: ["storage", "folder", "drive", "directory", "worktrees"] },
  { title: "Launch at login", section: "general", key: "launchAtLogin", keywords: ["startup", "boot", "open"] },
  { title: "Send key", section: "general", key: "composerSendKey", keywords: ["enter", "composer", "submit"] },
  { title: "Share usage reports", section: "general", key: "analyticsEnabled", keywords: ["analytics", "privacy", "telemetry", "consent"] },
  { title: "Browser access", section: "gateway", key: "remoteAccess", keywords: ["remote", "pairing", "web", "control", "devices"] },
  { title: "Menu bar", section: "general", key: "showMenuBarExtra", keywords: ["tray", "status bar", "extra"] },
  { title: "Desktop companion", section: "general", keywords: ["pet", "mascot", "capsule", "animation", "motion"] },
  { title: "Auto-resume limited conversations", section: "general", key: "autoResumeOnLimit", keywords: ["usage limit", "rate limit", "reset", "resume", "quota"] },
  { title: "Agent simulator access", section: "general", key: "agentSimulatorAccess", keywords: ["ios", "simulator", "device", "xcode", "touch", "attach"] },
  { title: "Local performance", section: "diagnostics", keywords: ["freeze", "timings", "slow", "git", "preview"] },
  { title: "Download updates automatically", section: "general", key: "autoDownloadUpdates", keywords: ["update", "release", "background"] },
  { title: "Keep computer awake", section: "general", key: "keepAwakeWhileRunning", keywords: ["sleep", "power", "running"] },
  { title: "Response completions", section: "general", key: "notifyRunComplete", keywords: ["notification", "alert", "run complete"] },
  { title: "Approvals", section: "general", key: "notifyApprovals", keywords: ["notification", "permission"] },
  { title: "Bounce the Dock", section: "general", key: "bounceDockOnAttention", keywords: ["notification", "attention"] },
  { title: "Classify session states", section: "general", key: "autoClassifySessions", keywords: ["title", "auto", "conversations"] },
  { title: "Archive inactive", section: "general", key: "archiveInactiveAfter", keywords: ["cleanup", "old threads"] },
  { title: "Follow-ups", section: "general", key: "followUpBehavior", keywords: ["queue", "steer", "send during a turn"] },
  { title: "Confirm before deleting", section: "general", key: "confirmDelete", keywords: ["confirmation", "delete", "ask"] },
  { title: "Confirm before archiving", section: "general", key: "confirmArchive", keywords: ["confirmation", "archive", "ask"] },

  { title: "Theme", section: "appearance", key: "appearanceTheme", keywords: ["dark", "light", "system", "dark mode", "colour scheme"] },
  { title: "Transcript text size", section: "appearance", key: "transcriptSize", keywords: ["font size", "type"] },
  { title: "Transcript width", section: "appearance", key: "transcriptWidth", keywords: ["column", "measure"] },
  { title: "Time format", section: "appearance", key: "timeFormat", keywords: ["clock", "12-hour", "24-hour", "timestamp"] },
  { title: "Tool calls", section: "appearance", key: "toolCallDisplay", keywords: ["activity", "commands", "folded", "compact"] },
  { title: "Custom code font", section: "appearance", key: "customCodeFont", keywords: ["mono", "monospace", "terminal", "editor"] },
  { title: "Accent", section: "appearance", keywords: ["colour", "color", "palette"] },
  { title: "Translucent sidebar", section: "appearance", keywords: ["glass", "blur"] },
  { title: "Contrast", section: "appearance", keywords: ["separation", "borders"] },

  { title: "Default agent", section: "agents", key: "defaultAgentId", keywords: ["harness", "new thread", "model", "provider"] },
  { title: "Conversation workspace", section: "agents", key: "defaultWorkspaceMode", keywords: ["worktree", "isolation", "local"] },
  { title: "Gateway approval policy", section: "agents", key: "defaultPermission", keywords: ["permission", "access", "sandbox"] },
  { title: "Web search", section: "agents", key: "webAccess", keywords: ["internet", "fetch", "web access"] },
  { title: "Sandbox", section: "agents", key: "sandbox", keywords: ["filesystem", "safety"] },
  { title: "Output detail", section: "agents", key: "outputDetail", keywords: ["verbose", "concise"] },
  { title: "Reasoning summary", section: "agents", key: "reasoningSummary", keywords: ["thinking", "chain of thought", "model", "effort"] },
  { title: "skills.sh token", section: "agents", keywords: ["api key", "credential"] },

  {
    title: "Runtime",
    section: "agents", key: "runtimeMode",
    keywords: ["direct", "standalone", "openclaw", "gateway", "daemon", "acp", "offline"],
  },
  { title: "URL", section: "gateway", key: "gatewayUrl", keywords: ["openclaw", "websocket", "connect", "gateway"] },
  { title: "Operator token", section: "gateway", keywords: ["auth", "credential", "keychain"] },

  { title: "Tasks without a project", section: "projects", key: "projectlessFolder", keywords: ["inbox", "projectless", "default folder"] },

  { title: "Branch prefix", section: "sourceControl", key: "branchPrefix", keywords: ["git", "naming"] },
  { title: "Always force push", section: "sourceControl", key: "gitForceWithLease", keywords: ["push", "git", "force with lease"] },
  { title: "Create draft pull requests", section: "sourceControl", key: "prDraft", keywords: ["pr", "github", "draft"] },
  { title: "Pull request merge method", section: "sourceControl", key: "prMergeMethod", keywords: ["squash", "rebase", "pr"] },
  { title: "Diff layout", section: "sourceControl", key: "diffLayout", keywords: ["split", "unified", "side by side"] },
  { title: "Diff files", section: "sourceControl", key: "diffFileState", keywords: ["collapsed", "expanded", "folded"] },
  { title: "Watch and fix pull requests", section: "sourceControl", key: "prWatchAndFix", keywords: ["ci", "checks", "pr"] },
  { title: "Auto-merge when ready", section: "sourceControl", key: "prAutoMerge", keywords: ["merge", "green", "pr"] },
  { title: "Continue watching until merged", section: "sourceControl", key: "prWatchUntilMerged", keywords: ["poll", "pr"] },
  { title: "Review delivery", section: "sourceControl", key: "prReviewDelivery", keywords: ["pr", "chat"] },
  { title: "Commit instructions", section: "sourceControl", key: "commitInstructions", keywords: ["message", "template"] },
  { title: "Pull request instructions", section: "sourceControl", key: "prInstructions", keywords: ["pr", "template"] },

  { title: "skills.sh token", section: "skills", keywords: ["catalog", "install counts"] },
  { title: "Commands", section: "skills", keywords: ["slash", "custom commands", "prompt", "template", "commands folder"] },
  { title: "Other tools' folders", section: "skills", keywords: ["commands", "prompts", "import"] },

  { title: "Shortcuts", section: "shortcuts", keywords: ["keys", "bindings", "keyboard"] },
  { title: "Diagnostics", section: "diagnostics", keywords: ["logs", "support", "export"] },
  { title: "Version", section: "about", keywords: ["build", "release"] },
];

export interface SettingsSearchResult extends SettingsSearchItem {
  sectionLabel: string;
}

/**
 * Rank matches so a title hit outranks a keyword hit, and a prefix outranks a
 * mid-word match. Without that, searching "font" puts "Custom code font" below
 * whatever happens to mention fonts in its keywords.
 */
export function searchSettings(query: string, limit = 8, modified?: ReadonlySet<string>): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  if (isModifiedQuery(needle)) return modifiedSettings(needle.slice(MODIFIED.length).trim(), modified ?? new Set());

  const scored: Array<{ item: SettingsSearchItem; score: number }> = [];
  /* A section's own name finds the section: "appearance" opens Appearance. */
  for (const [section, label] of Object.entries(SETTINGS_SECTION_LABELS) as Array<[SettingsSectionId, string]>) {
    const name = label.toLowerCase();
    const score = name === needle ? 95 : name.startsWith(needle) ? 75 : 0;
    if (score && !SETTINGS_SEARCH_ITEMS.some((item) => item.title.toLowerCase() === name)) scored.push({ item: { title: label, section }, score });
  }
  for (const item of SETTINGS_SEARCH_ITEMS) {
    const title = item.title.toLowerCase();
    let score = 0;
    if (title === needle) score = 100;
    else if (title.startsWith(needle)) score = 80;
    else if (title.includes(needle)) score = 60;
    else if (item.keywords?.some((word) => word.toLowerCase().startsWith(needle))) score = 40;
    else if (item.keywords?.some((word) => word.toLowerCase().includes(needle))) score = 20;
    if (score > 0) scored.push({ item, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map(({ item }) => ({ ...item, sectionLabel: SETTINGS_SECTION_LABELS[item.section] }));
}

/**
 * Sections whose settings can be reset. Mirrors the non-empty entries of
 * SETTINGS_SECTION_KEYS in @capsule/shared, which the engine owns: the renderer
 * only sends a section id, so the key list itself stays in one place.
 * Sections absent here own no settings, and the reset control hides rather than
 * offering an action that would do nothing.
 */
export const SECTIONS_WITH_DEFAULTS: ReadonlySet<SettingsSectionId> = new Set([
  "general",
  "appearance",
  "agents",
  "gateway",
  "projects",
  "sourceControl",
  "shortcuts",
]);

const MODIFIED = "@modified";

/** `@modified`, or a prefix of it typed on the way there. */
export function isModifiedQuery(query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.startsWith(MODIFIED) || (needle.length >= 2 && MODIFIED.startsWith(needle));
}

/*
 * Every row some settings file set, in panel order, optionally narrowed by
 * the words after the filter. The answer to "what did I change?".
 */
function modifiedSettings(rest: string, modified: ReadonlySet<string>): SettingsSearchResult[] {
  const sections = Object.keys(SETTINGS_SECTION_LABELS);
  return SETTINGS_SEARCH_ITEMS
    .filter((item) => item.key && modified.has(item.key))
    .filter((item) => !rest || [item.title, ...(item.keywords ?? [])].some((word) => word.toLowerCase().includes(rest)))
    .sort((a, b) => sections.indexOf(a.section) - sections.indexOf(b.section))
    .map((item) => ({ ...item, sectionLabel: SETTINGS_SECTION_LABELS[item.section] }));
}

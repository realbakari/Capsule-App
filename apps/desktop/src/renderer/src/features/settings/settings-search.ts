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
  { title: "Launch at login", section: "general", keywords: ["startup", "boot", "open"] },
  { title: "Send key", section: "general", keywords: ["enter", "composer", "submit"] },
  { title: "Menu bar", section: "general", keywords: ["tray", "status bar", "extra"] },
  { title: "Keep computer awake", section: "general", keywords: ["sleep", "power", "running"] },
  { title: "Response completions", section: "general", keywords: ["notification", "alert", "run complete"] },
  { title: "Approvals", section: "general", keywords: ["notification", "permission"] },
  { title: "Bounce the Dock", section: "general", keywords: ["notification", "attention"] },
  { title: "Classify session states", section: "general", keywords: ["title", "auto", "conversations"] },
  { title: "Archive inactive", section: "general", keywords: ["cleanup", "old threads"] },

  { title: "Theme", section: "appearance", keywords: ["dark", "light", "system"] },
  { title: "Transcript text size", section: "appearance", keywords: ["font size", "type"] },
  { title: "Transcript width", section: "appearance", keywords: ["column", "measure"] },
  { title: "Custom code font", section: "appearance", keywords: ["mono", "monospace"] },
  { title: "Accent", section: "appearance", keywords: ["colour", "color", "palette"] },
  { title: "Translucent sidebar", section: "appearance", keywords: ["glass", "blur"] },
  { title: "Contrast", section: "appearance", keywords: ["separation", "borders"] },

  { title: "Default mode", section: "agents", keywords: ["new conversation"] },
  { title: "Default agent", section: "agents", keywords: ["harness", "new thread"] },
  { title: "Conversation workspace", section: "agents", keywords: ["worktree", "isolation", "local"] },
  { title: "Approval policy", section: "agents", keywords: ["permission", "access", "sandbox"] },
  { title: "Web search", section: "agents", keywords: ["internet", "fetch", "web access"] },
  { title: "Sandbox", section: "agents", keywords: ["filesystem", "safety"] },
  { title: "Output detail", section: "agents", keywords: ["verbose", "concise"] },
  { title: "Reasoning summary", section: "agents", keywords: ["thinking", "chain of thought"] },
  { title: "skills.sh token", section: "agents", keywords: ["api key", "credential"] },

  { title: "URL", section: "gateway", keywords: ["openclaw", "websocket", "connect", "gateway"] },
  { title: "Operator token", section: "gateway", keywords: ["auth", "credential", "keychain"] },

  { title: "Tasks without a project", section: "projects", keywords: ["inbox", "projectless", "default folder"] },

  { title: "Branch prefix", section: "sourceControl", keywords: ["git", "naming"] },
  { title: "Always force push", section: "sourceControl", keywords: ["push", "git", "force with lease"] },
  { title: "Create draft pull requests", section: "sourceControl", keywords: ["pr", "github", "draft"] },
  { title: "Pull request merge method", section: "sourceControl", keywords: ["squash", "rebase", "pr"] },
  { title: "Review delivery", section: "sourceControl", keywords: ["pr", "chat"] },
  { title: "Commit instructions", section: "sourceControl", keywords: ["message", "template"] },
  { title: "Pull request instructions", section: "sourceControl", keywords: ["pr", "template"] },

  { title: "skills.sh token", section: "skills", keywords: ["catalog", "install counts"] },

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
export function searchSettings(query: string, limit = 8): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const scored: Array<{ item: SettingsSearchItem; score: number }> = [];
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
]);

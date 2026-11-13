import type { CommandSourceId, ConfigProblem } from "./config.js";
import type { MessageAttachment } from "./types.js";

/**
 * Where a command file came from, highest precedence first. `claude` and
 * `codex` are other tools' folders, read only when the user turns them on.
 */
export type CommandSource = "project" | "user" | "plugin" | "claude" | "codex";

/** One command as the `/` menu, the palette and Settings show it. */
export interface CommandSummary {
  name: string;
  description?: string;
  argumentHint?: string;
  source: CommandSource;
  /** A project's folder or the user's own. A project command's shell waits for trust. */
  scope: "user" | "project";
  path: string;
  /** `review` fills the composer with the expanded text instead of sending it. */
  send: "auto" | "review";
  /** Whether expanding it runs `` !`cmd` `` spans, and whether those wait for the folder to be trusted. */
  shell: "none" | "runs" | "needs-trust";
}

export interface CommandList {
  commands: CommandSummary[];
  /** Frontmatter mistakes, unusable names, and files a higher-precedence command shadows. */
  problems: ConfigProblem[];
  /** Which of other tools' folders the user's settings turn on. */
  sources: Partial<Record<CommandSourceId, boolean>>;
}

export interface CommandExpandInput {
  projectId: string;
  /** The thread whose folder `!` spans and `@` mentions use; the project's folder without one. */
  sessionId?: string;
  /** What was typed: `/name arguments`. */
  text: string;
}

export interface CommandExpansion {
  text: string;
  /** Files the command's `@path` mentions name inside the folder. */
  attachments: MessageAttachment[];
  problems: string[];
}

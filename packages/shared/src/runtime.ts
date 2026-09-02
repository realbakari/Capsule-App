import {
  DEFAULT_DARK_PALETTE,
  DEFAULT_LIGHT_PALETTE,
  normalizeAppearancePalette,
  type AppearancePalette,
  type AppearanceTheme,
} from "./appearance.js";
import type { HarnessPermissionProfile } from "./harness.js";
import type {
  Agent,
  AgentMessage,
  AgentMode,
  ApprovalRequest,
  ChannelBinding,
  CreateSessionInput,
  Run,
  RunEvent,
  RuntimeStatus,
  Session,
  Skill,
  Unsubscribe,
} from "./types.js";

export type RunEventHandler = (event: RunEvent) => void;

export interface CreateSessionInputRuntime extends CreateSessionInput {
  projectId: string;
}

export interface AgentRuntime {
  readonly kind: "openclaw" | "mock";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<RuntimeStatus>;
  listAgents(): Promise<Agent[]>;
  listSkills(): Promise<Skill[]>;
  listChannels(): Promise<ChannelBinding[]>;
  createSession(input: CreateSessionInputRuntime): Promise<Session>;
  sendMessage(input: AgentMessage): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  subscribeToRun(runId: string, handler: RunEventHandler): Unsubscribe;
  resolveApproval?(
    approvalId: string,
    decision: "approved_once" | "approved_session" | "denied",
  ): Promise<void>;
  listApprovals?(): Promise<ApprovalRequest[]>;
}

export type ComposerSendKey = "enter" | "cmd-enter";

export type WebAccess = "off" | "ask" | "on";
export type SandboxMode = "off" | "ask" | "strict";
export type OutputDetail = "concise" | "standard" | "verbose";
export type ReasoningSummary = "hidden" | "collapsed" | "visible";
export type TranscriptSize = "s" | "m" | "l";
export type TranscriptWidth = "narrow" | "standard" | "wide";
export type ArchiveInactiveAfter = "never" | "1d" | "7d" | "30d";
export type SessionClassification = "blocked" | "done";
export type PrMergeMethod = "merge" | "squash" | "rebase";
export type PrReviewDelivery = "current" | "new-chat";
export type DefaultWorkspaceMode = "local" | "worktree";

export const TOKEN_PRESENT_MASK = "••••";

export const TRANSCRIPT_SIZE_CSS: Record<TranscriptSize, string> = {
  s: "0.8125rem",
  m: "0.9375rem",
  l: "1.0625rem",
};

export const TRANSCRIPT_WIDTH_CSS: Record<TranscriptWidth, string> = {
  narrow: "40rem",
  standard: "48rem",
  wide: "60rem",
};

export const ARCHIVE_INACTIVE_MS: Record<ArchiveInactiveAfter, number | null> = {
  never: null,
  "1d": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const DEFAULT_CAPSULE_SETTINGS: CapsuleSettings = {
  gatewayUrl: "ws://127.0.0.1:18789",
  launchAtLogin: false,
  composerSendKey: "enter",
  defaultMode: "chat",
  defaultWorkspaceMode: "local",
  defaultPermission: "default",
  // Follows the Mac. A first run that ignores a light system and opens dark
  // is the app deciding something it was never asked to decide.
  // Reading Capsule from another device is off until someone says otherwise,
  // and reaching it from the network is a second, separate choice.
  remoteAccess: "off",
  appearanceTheme: "system",
  appearanceLight: DEFAULT_LIGHT_PALETTE,
  appearanceDark: DEFAULT_DARK_PALETTE,
  webAccess: "on",
  sandbox: "ask",
  outputDetail: "standard",
  reasoningSummary: "visible",
  transcriptSize: "m",
  transcriptWidth: "standard",
  notifyRunComplete: true,
  notifyApprovals: true,
  bounceDockOnAttention: true,
  showMenuBarExtra: true,
  keepAwakeWhileRunning: false,
  autoClassifySessions: true,
  archiveInactiveAfter: "never",
  gitForceWithLease: false,
  prDraft: false,
  prMergeMethod: "squash",
  prReviewDelivery: "current",
  prWatchAndFix: false,
  prAutoMerge: false,
  prWatchUntilMerged: false,
};

/**
 * Which settings each section owns, so "Restore defaults" can reset exactly
 * what is on screen instead of the whole file.
 *
 * Two deliberate omissions. Secrets (gatewayToken, skillsShToken) are held in
 * the Keychain and are never reset by this path: a reset is an undo for a
 * preference, not a way to silently sign someone out. And projects, shortcuts,
 * diagnostics and about own no settings at all, so they get an empty list and
 * the button hides rather than offering a reset that would do nothing.
 */
export const SETTINGS_SECTION_KEYS: Record<string, ReadonlyArray<keyof CapsuleSettings>> = {
  general: [
    "launchAtLogin",
    "composerSendKey",
    "showMenuBarExtra",
    "keepAwakeWhileRunning",
    "notifyRunComplete",
    "notifyApprovals",
    "bounceDockOnAttention",
    "autoClassifySessions",
    "archiveInactiveAfter",
  ],
  appearance: [
    "appearanceTheme",
    "appearanceLight",
    "appearanceDark",
    "transcriptSize",
    "transcriptWidth",
    "customCodeFont",
  ],
  agents: [
    "defaultMode",
    "defaultWorkspaceMode",
    "defaultAgentId",
    "defaultPermission",
    "webAccess",
    "sandbox",
    "outputDetail",
    "reasoningSummary",
  ],
  gateway: ["gatewayUrl"],
  projects: ["projectlessFolder"],
  sourceControl: [
    "branchPrefix",
    "gitForceWithLease",
    "prDraft",
    "prMergeMethod",
    "prReviewDelivery",
    "prWatchAndFix",
    "prAutoMerge",
    "prWatchUntilMerged",
    "commitInstructions",
    "prInstructions",
  ],
  skills: [],
  shortcuts: [],
  diagnostics: [],
  about: [],
};

/** Who can reach this Capsule: nobody, this Mac, or the local network. */
export type RemoteAccess = "off" | "loopback" | "network";

export interface CapsuleSettings {
  gatewayUrl: string;
  gatewayToken?: string;
  /**
   * Vercel OIDC token for the skills.sh API. Every skills.sh endpoint answers
   * 401 without one, so the directory reads GitHub unless this is set.
   * Stored in the Keychain like gatewayToken; masked on the way out.
   */
  skillsShToken?: string;
  launchAtLogin: boolean;
  composerSendKey: ComposerSendKey;
  defaultMode: AgentMode;
  /** Default isolation for conversations created inside Git projects. */
  defaultWorkspaceMode: DefaultWorkspaceMode;
  defaultPermission: HarnessPermissionProfile;
  defaultAgentId?: string;
  /** Root folder for Inbox / tasks started without opening a project. */
  projectlessFolder?: string;
  remoteAccess: RemoteAccess;
  appearanceTheme: AppearanceTheme;
  appearanceLight: AppearancePalette;
  appearanceDark: AppearancePalette;
  webAccess: WebAccess;
  sandbox: SandboxMode;
  outputDetail: OutputDetail;
  reasoningSummary: ReasoningSummary;
  transcriptSize: TranscriptSize;
  transcriptWidth: TranscriptWidth;
  /** Extra family prepended to the code font stack, e.g. JetBrains Mono. */
  customCodeFont?: string;
  notifyRunComplete: boolean;
  notifyApprovals: boolean;
  bounceDockOnAttention: boolean;
  showMenuBarExtra: boolean;
  keepAwakeWhileRunning: boolean;
  autoClassifySessions: boolean;
  archiveInactiveAfter: ArchiveInactiveAfter;
  /** Prefixed onto new branches created from the inspector. */
  branchPrefix?: string;
  gitForceWithLease: boolean;
  prDraft: boolean;
  prMergeMethod: PrMergeMethod;
  prReviewDelivery: PrReviewDelivery;
  prWatchAndFix: boolean;
  prAutoMerge: boolean;
  prWatchUntilMerged: boolean;
  commitInstructions?: string;
  prInstructions?: string;
  /**
   * Rebound keyboard shortcuts, as command id -> chord ("meta+shift+f").
   * Only commands the renderer owns appear here; menu accelerators are
   * declared by the application menu in the main process.
   */
  keybindings?: Record<string, string>;
}

const AGENT_MODES: AgentMode[] = [
  "chat",
  "agent",
  "plan",
  "code",
  "research",
  "browser",
  "automation",
];
const WORKSPACE_MODES: DefaultWorkspaceMode[] = ["local", "worktree"];
const SEND_KEYS: ComposerSendKey[] = ["enter", "cmd-enter"];
const THEMES: AppearanceTheme[] = ["system", "dark", "light"];
const REMOTE_ACCESS: RemoteAccess[] = ["off", "loopback", "network"];
const PERMISSIONS: HarnessPermissionProfile[] = ["default", "strict", "approve-all"];
const WEB_ACCESS: WebAccess[] = ["off", "ask", "on"];
const SANDBOX: SandboxMode[] = ["off", "ask", "strict"];
const OUTPUT_DETAIL: OutputDetail[] = ["concise", "standard", "verbose"];
const REASONING: ReasoningSummary[] = ["hidden", "collapsed", "visible"];
const TRANSCRIPT_SIZES: TranscriptSize[] = ["s", "m", "l"];
const TRANSCRIPT_WIDTHS: TranscriptWidth[] = ["narrow", "standard", "wide"];
const ARCHIVE_AFTER: ArchiveInactiveAfter[] = ["never", "1d", "7d", "30d"];
const PR_MERGE: PrMergeMethod[] = ["merge", "squash", "rebase"];
const PR_REVIEW: PrReviewDelivery[] = ["current", "new-chat"];

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeFontName(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 80) return undefined;
  if (!/^[\w][\w -]*$/.test(trimmed)) return undefined;
  return trimmed;
}

export function normalizeBranchPrefix(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  const cleaned = trimmed
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 40);
  return cleaned || undefined;
}

export function sanitizeGuidance(value: string | undefined, max = 2000): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export function pullRequestWatchEnabled(settings: CapsuleSettings): boolean {
  return settings.prWatchAndFix || settings.prAutoMerge || settings.prWatchUntilMerged;
}

export function applyBranchPrefix(prefix: string | undefined, name: string): string {
  const trimmed = name.trim().replace(/^\/+/, "");
  const pre = normalizeBranchPrefix(prefix);
  if (!trimmed || !pre) return trimmed;
  if (trimmed === pre || trimmed.startsWith(`${pre}/`)) return trimmed;
  return `${pre}/${trimmed}`;
}

export function classifySessionFromRun(
  run: { status: string } | undefined,
): SessionClassification | undefined {
  if (!run) return undefined;
  if (run.status === "approval_required" || run.status === "blocked" || run.status === "failed") {
    return "blocked";
  }
  if (run.status === "completed") return "done";
  return undefined;
}

export function agentInstructionHints(settings: CapsuleSettings): string[] {
  const hints: string[] = [];
  if (settings.outputDetail === "concise") {
    hints.push("Keep the reply concise. Do not restate the request.");
  }
  if (settings.outputDetail === "verbose") {
    hints.push("Include files touched, commands run, and how to verify.");
  }
  if (settings.webAccess === "off") {
    hints.push("Do not use web search or fetch URLs.");
  }
  if (settings.webAccess === "ask") {
    hints.push("Ask before using web search or fetching URLs.");
  }
  if (settings.sandbox === "strict") {
    hints.push("Do not run shell commands. Stay inside the project folder.");
  }
  if (settings.sandbox === "off") {
    hints.push("You may run project commands without asking.");
  }
  if (settings.commitInstructions) {
    hints.push(`Commit messages: ${settings.commitInstructions}`);
  }
  if (settings.prInstructions) {
    hints.push(`Pull request title and description: ${settings.prInstructions}`);
  }
  if (settings.gitForceWithLease) {
    hints.push("When pushing, use --force-with-lease, not --force.");
  }
  if (settings.prDraft) {
    hints.push("Open pull requests as drafts.");
  }
  if (settings.prMergeMethod === "rebase") {
    hints.push("Merge pull requests with rebase.");
  }
  if (settings.prMergeMethod === "merge") {
    hints.push("Merge pull requests with a merge commit.");
  }
  return hints;
}

export function applyAgentInstructionHints(content: string, settings: CapsuleSettings): string {
  const hints = agentInstructionHints(settings);
  if (hints.length === 0) return content;
  return `${content}\n\n${hints.map((hint) => `Instruction: ${hint}`).join("\n")}`;
}

export function shouldArchiveInactiveSession(input: {
  state: string;
  pinned?: boolean;
  updatedAt: string;
  liveHarness: boolean;
  hasActiveRun: boolean;
  cutoffMs: number;
  now?: number;
}): boolean {
  if (input.state !== "active") return false;
  if (input.pinned) return false;
  if (input.liveHarness || input.hasActiveRun) return false;
  const updated = Date.parse(input.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return (input.now ?? Date.now()) - updated >= input.cutoffMs;
}

export function normalizeCapsuleSettings(input: Partial<CapsuleSettings> = {}): CapsuleSettings {
  const gatewayUrl = input.gatewayUrl?.trim() || DEFAULT_CAPSULE_SETTINGS.gatewayUrl;
  const defaultAgentId = input.defaultAgentId?.trim();
  return {
    gatewayUrl,
    gatewayToken: input.gatewayToken,
    launchAtLogin: Boolean(input.launchAtLogin),
    composerSendKey: pick(
      input.composerSendKey,
      SEND_KEYS,
      DEFAULT_CAPSULE_SETTINGS.composerSendKey,
    ),
    defaultMode: pick(input.defaultMode, AGENT_MODES, DEFAULT_CAPSULE_SETTINGS.defaultMode),
    defaultWorkspaceMode: pick(
      input.defaultWorkspaceMode,
      WORKSPACE_MODES,
      DEFAULT_CAPSULE_SETTINGS.defaultWorkspaceMode,
    ),
    defaultPermission: pick(
      input.defaultPermission,
      PERMISSIONS,
      DEFAULT_CAPSULE_SETTINGS.defaultPermission,
    ),
    defaultAgentId: defaultAgentId || undefined,
    projectlessFolder: input.projectlessFolder?.trim() || undefined,
    remoteAccess: pick(input.remoteAccess, REMOTE_ACCESS, DEFAULT_CAPSULE_SETTINGS.remoteAccess),
    appearanceTheme: pick(input.appearanceTheme, THEMES, DEFAULT_CAPSULE_SETTINGS.appearanceTheme),
    appearanceLight: normalizeAppearancePalette(input.appearanceLight, DEFAULT_LIGHT_PALETTE),
    appearanceDark: normalizeAppearancePalette(input.appearanceDark, DEFAULT_DARK_PALETTE),
    webAccess: pick(input.webAccess, WEB_ACCESS, DEFAULT_CAPSULE_SETTINGS.webAccess),
    sandbox: pick(input.sandbox, SANDBOX, DEFAULT_CAPSULE_SETTINGS.sandbox),
    outputDetail: pick(input.outputDetail, OUTPUT_DETAIL, DEFAULT_CAPSULE_SETTINGS.outputDetail),
    reasoningSummary: pick(input.reasoningSummary, REASONING, DEFAULT_CAPSULE_SETTINGS.reasoningSummary),
    transcriptSize: pick(input.transcriptSize, TRANSCRIPT_SIZES, DEFAULT_CAPSULE_SETTINGS.transcriptSize),
    transcriptWidth: pick(
      input.transcriptWidth,
      TRANSCRIPT_WIDTHS,
      DEFAULT_CAPSULE_SETTINGS.transcriptWidth,
    ),
    customCodeFont: sanitizeFontName(input.customCodeFont),
    notifyRunComplete: flag(input.notifyRunComplete, DEFAULT_CAPSULE_SETTINGS.notifyRunComplete),
    notifyApprovals: flag(input.notifyApprovals, DEFAULT_CAPSULE_SETTINGS.notifyApprovals),
    bounceDockOnAttention: flag(
      input.bounceDockOnAttention,
      DEFAULT_CAPSULE_SETTINGS.bounceDockOnAttention,
    ),
    showMenuBarExtra: flag(input.showMenuBarExtra, DEFAULT_CAPSULE_SETTINGS.showMenuBarExtra),
    keepAwakeWhileRunning: flag(
      input.keepAwakeWhileRunning,
      DEFAULT_CAPSULE_SETTINGS.keepAwakeWhileRunning,
    ),
    autoClassifySessions: flag(
      input.autoClassifySessions,
      DEFAULT_CAPSULE_SETTINGS.autoClassifySessions,
    ),
    archiveInactiveAfter: pick(
      input.archiveInactiveAfter,
      ARCHIVE_AFTER,
      DEFAULT_CAPSULE_SETTINGS.archiveInactiveAfter,
    ),
    branchPrefix: normalizeBranchPrefix(input.branchPrefix),
    gitForceWithLease: flag(input.gitForceWithLease, DEFAULT_CAPSULE_SETTINGS.gitForceWithLease),
    prDraft: flag(input.prDraft, DEFAULT_CAPSULE_SETTINGS.prDraft),
    prMergeMethod: pick(input.prMergeMethod, PR_MERGE, DEFAULT_CAPSULE_SETTINGS.prMergeMethod),
    prReviewDelivery: pick(
      input.prReviewDelivery,
      PR_REVIEW,
      DEFAULT_CAPSULE_SETTINGS.prReviewDelivery,
    ),
    prWatchAndFix: flag(input.prWatchAndFix, DEFAULT_CAPSULE_SETTINGS.prWatchAndFix),
    prAutoMerge: flag(input.prAutoMerge, DEFAULT_CAPSULE_SETTINGS.prAutoMerge),
    prWatchUntilMerged: flag(
      input.prWatchUntilMerged,
      DEFAULT_CAPSULE_SETTINGS.prWatchUntilMerged,
    ),
    commitInstructions: sanitizeGuidance(input.commitInstructions),
    prInstructions: sanitizeGuidance(input.prInstructions),
  };
}

export const ACP_HARNESS_IDS = [
  "claude",
  "codex",
  "copilot",
  "cursor",
  "droid",
  "fast-agent",
  "gemini",
  "iflow",
  "kilocode",
  "kimi",
  "kiro",
  "mux",
  "opencode",
  "openclaw",
  "qoder",
  "qwen",
  "trae",
] as const;

export type HarnessId = (typeof ACP_HARNESS_IDS)[number];

export const PRIMARY_HARNESS_IDS: HarnessId[] = ["claude", "codex"];

export type HarnessReadiness =
  | "ready"
  | "missing_cli"
  | "needs_login"
  | "missing_acpx"
  | "gateway_offline"
  | "dedicated"
  | "running";

/**
 * Result of asking a harness CLI whether it is signed in. Capsule never sees
 * the credentials themselves — only the CLI's own verdict.
 */
export type HarnessLoginState = "logged_in" | "logged_out" | "config_invalid" | "unknown";

export type AcpMode = "persistent" | "oneshot";

export type HarnessPermissionProfile = "default" | "strict" | "approve-all";

/*
 * An ACP session has no channel to ask a question through: acpx throws
 * PermissionPromptUnavailableError the moment a tool needs approval and no
 * terminal is attached. Its own modes are ranked deny-all(0) <
 * approve-reads(1) < approve-all(2), and only the two ends are non-fatal —
 * approve-reads still falls through to the prompt for writes and commands.
 *
 * So "ask me" cannot be honoured here, and the labels say what actually
 * happens rather than what we would prefer.
 */
export const PERMISSION_PROFILES: Array<{ id: HarnessPermissionProfile; label: string; detail: string }> = [
  {
    id: "strict",
    label: "Supervised",
    detail: "Refuse tools that would need a prompt. ACP cannot show a dialog, so it never asks.",
  },
  {
    id: "default",
    label: "Standard",
    detail: "Gateway approve-all: read, write, shell, and network without a TTY prompt.",
  },
  {
    id: "approve-all",
    label: "Full access",
    detail: "Same as Standard for ACP: approve-all. Use when you want that spelled out.",
  },
];

export type HarnessSessionState =
  | "idle"
  | "spawning"
  | "running"
  | "waiting"
  | "closed"
  | "error";

export type HarnessOptionKey = "model" | "permissions" | "cwd" | "mode" | "timeout";

export interface HarnessPreset {
  id: HarnessId;
  name: string;
  description: string;
  /** OpenClaw ACP target id (`/acp spawn <id>`). */
  openclawAgentId: string;
  binaries: string[];
  installHint: string;
  installUrl: string;
  /**
   * The CLI the ACP adapter drives, when they differ. `binaries` names the
   * adapter entrypoints Capsule looks for; this names the tool behind it, which
   * is what the user actually installs and signs into.
   */
  underlyingCli?: string;
  /** Where the harness keeps its own configuration, for Doctor and diagnostics. */
  configFilePath?: string;
  /**
   * Shown in the main Runtimes list rather than behind "Other ACP targets".
   * A property of the harness, not something a component should decide by
   * comparing ids.
   */
  featured?: boolean;
  /**
   * True when the harness is bound to a single inference provider and offers no
   * provider choice (Claude Code is Anthropic-only).
   */
  providerLocked?: boolean;
  /**
   * Subcommand that reports sign-in state, e.g. `claude auth status`. Exit 0
   * means signed in. Only set for harnesses whose CLI offers such a check;
   * without it Capsule cannot tell logged-out from ready and does not guess.
   */
  loginProbeArgs?: string[];
  /** What the user has to run when the probe says logged out. */
  loginHint?: string;
}

export interface HarnessDoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface HarnessDoctorReport {
  harnessId: HarnessId;
  ready: boolean;
  checks: HarnessDoctorCheck[];
  gatewayOutput?: string;
}

export interface HarnessStatus extends HarnessPreset {
  readiness: HarnessReadiness;
  binaryPath?: string;
  acpxEnabled: boolean;
  dedicatedProjectIds: string[];
  liveSessionIds: string[];
  detail: string;
  loginState?: HarnessLoginState;
}

export interface SpawnHarnessInput {
  projectId: string;
  harnessId: HarnessId;
  sessionId?: string;
  prompt?: string;
  cwd?: string;
  mode?: AcpMode;
  permissionProfile?: HarnessPermissionProfile;
  model?: string;
}

export interface HarnessControlResult {
  session: SessionRef;
  command?: string;
  usedSlashCommand?: boolean;
  detail?: string;
  statusText?: string;
}

export interface HarnessLiveStatus {
  session: SessionRef;
  harnessId?: HarnessId;
  state: HarnessSessionState;
  openclawSessionKey?: string;
  statusText?: string;
  parsed?: AcpStatusSnapshot;
}

export interface HarnessOptionPatch {
  sessionId: string;
  key: HarnessOptionKey;
  value: string;
}

export interface AcpStatusSnapshot {
  backend?: string;
  mode?: string;
  state?: string;
  model?: string;
  cwd?: string;
  permissions?: string;
  timeout?: string;
  thinking?: string;
}

/** Lightweight session shape so harness types do not import the full domain graph. */
export interface SessionRef {
  id: string;
  projectId: string;
  agentId: string;
  title: string;
  mode: string;
  state: string;
  openclawSessionKey?: string;
  harnessId?: HarnessId;
  harnessState?: HarnessSessionState;
  acpMode?: AcpMode;
  permissionProfile?: string;
  modelOverride?: string;
}

function preset(
  id: HarnessId,
  name: string,
  description: string,
  binaries: string[],
  installHint: string,
  installUrl: string,
  login?: { probeArgs: string[]; hint: string },
  capabilities?: {
    underlyingCli?: string;
    configFilePath?: string;
    providerLocked?: boolean;
    featured?: boolean;
  },
): HarnessPreset {
  return {
    id,
    name,
    description,
    openclawAgentId: id,
    binaries,
    installHint,
    installUrl,
    ...(login ? { loginProbeArgs: login.probeArgs, loginHint: login.hint } : {}),
    ...capabilities,
  };
}

export const PRESET_HARNESSES: HarnessPreset[] = [
  preset(
    "claude",
    "Claude Code",
    "Anthropic Claude Code through OpenClaw ACP (acpx). Capsule owns the workspace; Claude owns the coding loop.",
    ["claude"],
    "Authenticate Claude Code on the OpenClaw Gateway host. Capsule does not install it.",
    "https://claude.ai/code",
    { probeArgs: ["auth", "status"], hint: "Run `claude` and complete sign-in" },
    {
      underlyingCli: "claude",
      configFilePath: "~/.claude/settings.json",
      providerLocked: true,
      featured: true,
    },
  ),
  preset(
    "codex",
    "Codex",
    "Explicit Codex ACP fallback. Prefer native /codex on the Gateway when that plugin is enabled; dedicate Codex here to force the ACP path.",
    ["codex"],
    "Authenticate the Codex CLI on the Gateway host. Native /codex is a different route from /acp spawn codex.",
    "https://developers.openai.com/codex/cli",
    { probeArgs: ["login", "status"], hint: "Run `codex login`" },
    { underlyingCli: "codex", configFilePath: "~/.codex/config.toml", featured: true },
  ),
  preset(
    "copilot",
    "GitHub Copilot",
    "GitHub Copilot CLI through the acpx Copilot ACP adapter.",
    ["copilot"],
    "Install and authenticate Copilot CLI on the Gateway host.",
    "https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli",
  ),
  preset(
    "cursor",
    "Cursor",
    "Cursor CLI ACP (`cursor-agent acp`). Override the acpx command if the local install uses a different entrypoint.",
    ["cursor-agent", "cursor"],
    "Install Cursor CLI on the Gateway host and expose an ACP entrypoint.",
    "https://cursor.com/docs/cli/acp",
  ),
  preset(
    "droid",
    "Factory Droid",
    "Factory Droid CLI through acpx. `factory-droid` and `factorydroid` also resolve to this adapter.",
    ["droid", "factory-droid"],
    "Authenticate Factory/Droid or set FACTORY_API_KEY on the Gateway host.",
    "https://www.factory.ai",
  ),
  preset(
    "gemini",
    "Gemini CLI",
    "Google Gemini CLI through the acpx Gemini ACP adapter.",
    ["gemini"],
    "Authenticate Gemini CLI or provide an API key on the Gateway host.",
    "https://github.com/google-gemini/gemini-cli",
  ),
  preset(
    "opencode",
    "OpenCode",
    "OpenCode ACP adapter. Requires OpenCode CLI/provider auth on the Gateway host.",
    ["opencode"],
    "Install and authenticate OpenCode on the Gateway host.",
    "https://opencode.ai",
  ),
  preset(
    "openclaw",
    "OpenClaw ACP",
    "OpenClaw Gateway bridge through `openclaw acp` — an ACP-aware harness talking back to a Gateway session.",
    ["openclaw"],
    "The Gateway host needs a working `openclaw` CLI. This is bridge mode, not a coding CLI install.",
    "https://docs.openclaw.ai/cli/acp",
  ),
  preset(
    "qwen",
    "Qwen Code",
    "Qwen Code / Qwen CLI through acpx.",
    ["qwen"],
    "Authenticate a Qwen-compatible CLI on the Gateway host.",
    "https://github.com/QwenLM/qwen-code",
  ),
  preset(
    "kimi",
    "Kimi",
    "Kimi/Moonshot CLI through acpx.",
    ["kimi"],
    "Authenticate Kimi/Moonshot on the Gateway host.",
    "https://github.com/MoonshotAI/kimi-cli",
  ),
  preset(
    "kilocode",
    "Kilo Code",
    "Kilo Code CLI through acpx. Model control depends on the installed CLI.",
    ["kilocode"],
    "Install Kilo Code CLI on the Gateway host.",
    "https://kilocode.ai",
  ),
  preset(
    "kiro",
    "Kiro",
    "Kiro CLI through acpx.",
    ["kiro"],
    "Install Kiro CLI on the Gateway host.",
    "https://kiro.dev",
  ),
  preset(
    "iflow",
    "iFlow",
    "iFlow CLI through acpx.",
    ["iflow"],
    "Install iFlow CLI on the Gateway host.",
    "https://github.com/iflow-ai/iflow-cli",
  ),
  preset(
    "mux",
    "Mux",
    "Mux CLI ACP adapter. acpx may fetch it on demand with npx.",
    ["mux"],
    "Install Mux CLI or let acpx fetch the adapter on first spawn.",
    "https://mux.coder.com",
  ),
  preset(
    "qoder",
    "Qoder",
    "Qoder CLI through acpx.",
    ["qoder"],
    "Install Qoder CLI on the Gateway host.",
    "https://docs.qoder.com/cli/acp",
  ),
  preset(
    "trae",
    "Trae",
    "Trae CLI ACP adapter.",
    ["trae"],
    "Install Trae CLI on the Gateway host.",
    "https://docs.trae.cn/cli",
  ),
  preset(
    "fast-agent",
    "fast-agent",
    "fast-agent-mcp ACP adapter. acpx may fetch it on demand with uvx.",
    ["fast-agent"],
    "Install fast-agent or let acpx fetch the adapter on first spawn.",
    "https://fast-agent.ai",
  ),
];

export const HARNESS_PERMISSION_PROFILES: HarnessPermissionProfile[] = [
  "default",
  "strict",
  "approve-all",
];

export const ACP_MODES: AcpMode[] = ["persistent", "oneshot"];

const HARNESS_ID_SET = new Set<string>(ACP_HARNESS_IDS);

export function isHarnessId(value: string | undefined): value is HarnessId {
  return Boolean(value && HARNESS_ID_SET.has(value));
}

export function isPrimaryHarness(value: string | undefined): boolean {
  return value === "claude" || value === "codex";
}

export function quoteAcpArg(value: string): string {
  if (/^[\w./:@+-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$])/g, "\\$1")}"`;
}

/*
 * acpx tokenizes slash-command arguments with a bare whitespace split and has
 * no quote handling at all:
 *
 *   const tokens = normalized.slice(COMMAND.length).trim().split(/\s+/)
 *
 * So quoting an option value does not protect it — the quote characters simply
 * survive into the tokens and the value still splits. `--label "Claude Code"`
 * parses as label=`"Claude` followed by a stray positional `Code`. Any value
 * passed through a slash command must therefore be a single whitespace-free
 * token.
 */

/** Reduces a label to one acpx-safe token. */
export function acpLabelToken(value: string): string {
  const token = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return token || "capsule";
}

export function acpSpawnCommand(
  id: HarnessId,
  options: { cwd?: string; mode?: AcpMode; bind?: "here" | "off"; label?: string } = {},
): string {
  const bind = options.bind ?? "off";
  const mode = options.mode ?? "persistent";
  const parts = [`/acp spawn ${id}`, `--bind ${bind}`, `--mode ${mode}`];
  if (options.cwd) {
    // A path cannot be slugified without breaking it, and acpx cannot receive
    // a value containing whitespace. Fail with the actual reason rather than
    // emitting a command that mis-parses into a confusing usage error.
    if (/\s/.test(options.cwd)) {
      throw new Error(
        `The working directory contains a space, which the Gateway's /acp spawn parser cannot accept: ${options.cwd}. Move the project to a path without spaces, or set a different working directory.`,
      );
    }
    parts.push(`--cwd ${options.cwd}`);
  }
  if (options.label) parts.push(`--label ${acpLabelToken(options.label)}`);
  return parts.join(" ");
}

export function acpCancelCommand(target?: string): string {
  return target ? `/acp cancel ${quoteAcpArg(target)}` : "/acp cancel";
}

export function acpSteerCommand(instruction: string, session?: string): string {
  const target = session ? `--session ${quoteAcpArg(session)} ` : "";
  return `/acp steer ${target}${instruction}`.trim();
}

export function acpCloseCommand(target?: string): string {
  return target ? `/acp close ${quoteAcpArg(target)}` : "/acp close";
}

export function acpStatusCommand(target?: string): string {
  return target ? `/acp status ${quoteAcpArg(target)}` : "/acp status";
}

export function acpDoctorCommand(): string {
  return "/acp doctor";
}

export function acpSessionsCommand(): string {
  return "/acp sessions";
}

export function acpModelCommand(model: string): string {
  return `/acp model ${quoteAcpArg(model)}`;
}

export function acpPermissionsCommand(profile: string): string {
  const mapped = acpxPermissionMode(profile as HarnessPermissionProfile);
  return `/acp permissions ${quoteAcpArg(mapped)}`;
}

export function acpCwdCommand(cwd: string): string {
  return `/acp cwd ${quoteAcpArg(cwd)}`;
}

export function acpSetModeCommand(mode: string): string {
  return `/acp set-mode ${quoteAcpArg(mode)}`;
}

export function acpTimeoutCommand(seconds: string | number): string {
  return `/acp timeout ${seconds}`;
}

export function acpSetCommand(key: string, value: string): string {
  return `/acp set ${quoteAcpArg(key)} ${quoteAcpArg(value)}`;
}

export function acpResetOptionsCommand(): string {
  return "/acp reset-options";
}

export function acpInstallCommand(): string {
  return "/acp install";
}

export function acpOptionCommand(key: HarnessOptionKey, value: string): string {
  if (key === "model") return acpModelCommand(value);
  if (key === "permissions") return acpPermissionsCommand(value);
  if (key === "cwd") return acpCwdCommand(value);
  if (key === "timeout") return acpTimeoutCommand(value);
  return acpSetModeCommand(value);
}

export function parseAcpStatus(text: string): AcpStatusSnapshot {
  const pick = (label: string) => {
    const match = text.match(new RegExp(`${label}\\s*[:\\-]?\\s*(\\S+)`, "i"));
    return match?.[1]?.replace(/[,"']+$/, "");
  };
  return {
    backend: pick("backend"),
    mode: pick("mode"),
    state: pick("state") ?? pick("status"),
    model: pick("model"),
    cwd: pick("cwd") ?? pick("working.?directory"),
    permissions: pick("permissions") ?? pick("permission.?profile") ?? pick("approval.?policy"),
    timeout: pick("timeout"),
    thinking: pick("thinking") ?? pick("reasoning.?effort"),
  };
}

export function isAcpSessionKey(key: string | undefined): boolean {
  return Boolean(key && (key.includes(":acp:") || key.startsWith("acp:")));
}

/**
 * The Gateway treats a session `label` as a unique key, but a conversation
 * title is not unique — every new thread starts life as "New conversation", so
 * the second one is rejected with "label already in use". Suffix the title with
 * a short slice of the owning id: unique per conversation, stable across
 * renames, and still readable in `openclaw sessions list`.
 */
export function gatewaySessionLabel(title: string | undefined, id: string): string {
  const base = title?.trim() || "Conversation";
  return `${base} (${id.slice(-6)})`;
}

/**
 * The display name for a harness id. Components must not branch on the id —
 * `harnessId === "codex" ? "Codex" : "Claude Code"` silently mislabels every
 * other ACP target as Claude Code.
 */
export function harnessDisplayName(id: string | undefined, fallback = "Agent"): string {
  if (!id) return fallback;
  return PRESET_HARNESSES.find((preset) => preset.id === id)?.name ?? fallback;
}

/** Harnesses surfaced in the main Runtimes list. */
export function isFeaturedHarness(harness: { featured?: boolean }): boolean {
  return harness.featured === true;
}

/**
 * Capsule's profile expressed in acpx's own vocabulary.
 *
 * acpx accepts only `approve-all | approve-reads | deny-all`, so "strict" was
 * never a value it understood — it was sent verbatim and ignored. And leaving
 * the profile unset left acpx on the mode that kills the turn outright, which
 * is what produced "Permission prompt unavailable in non-interactive mode".
 */
export function acpxPermissionMode(
  profile: string | undefined,
): "approve-all" | "deny-all" {
  // approve-reads is deliberately unused: it still throws on the first write
  // or command, which is the failure this mapping exists to remove.
  if (profile === "strict" || profile === "deny-all") return "deny-all";
  return "approve-all";
}

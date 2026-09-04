export const ACP_HARNESS_IDS = [
  "claude",
  "codex",
  "grok",
  "copilot",
  "cursor",
  "droid",
  "fast-agent",
  "gemini",
  "gemini-flash",
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

export const PRIMARY_HARNESS_IDS: HarnessId[] = ["claude", "codex", "grok"];

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
  /**
   * Native ACP stdio command for agents that are not built into every acpx
   * release. Capsule registers this thin mapping with OpenClaw before Doctor
   * or Spawn; the coding loop still belongs to the CLI and acpx.
   */
  acpxCommand?: { command: string; args?: string[] };
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

/** One choice a harness offers, as the harness itself describes it. */
export interface AcpConfigChoice {
  value: string;
  name: string;
  description?: string;
}

/**
 * A setting the running harness says it accepts.
 *
 * acpx reports these in its status — the models a backend will run, its
 * reasoning effort levels, its permission modes — each with the values it
 * takes and the one it is on. Capsule used to let you set a model by typing
 * one, with no way to see what the agent would actually accept.
 */
export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string;
  currentValue?: string;
  choices: AcpConfigChoice[];
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
  /** What this harness says it can be set to, when it says anything. */
  configOptions?: AcpConfigOption[];
  models?: AcpModelCatalog;
}

export interface AcpModelCatalog {
  currentModelId?: string;
  availableModels: Array<{ modelId: string; name: string }>;
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
    acpxCommand?: { command: string; args?: string[] };
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

/*
 * The Flash model this harness pins.
 *
 * `--acp` is the CLI's own ACP mode — the `--experimental-acp` spelling still
 * works but is deprecated as of 0.52. The model id is the one the CLI calls
 * its current Flash; older releases answer to `gemini-2.5-flash`.
 */
export const GEMINI_FLASH_MODEL = "gemini-3.5-flash";

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
    "grok",
    "Grok Build",
    "xAI Grok Build through its native ACP stdio mode. Capsule owns the workspace; Grok owns the coding loop.",
    ["grok"],
    "Install and authenticate Grok Build on the OpenClaw Gateway host.",
    "https://github.com/xai-org/grok-build",
    undefined,
    {
      underlyingCli: "grok",
      configFilePath: "~/.grok/config.toml",
      providerLocked: true,
      featured: true,
      acpxCommand: { command: "grok", args: ["agent", "stdio"] },
    },
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
    "gemini-flash",
    "Gemini Flash",
    "Google's Gemini CLI in its own ACP mode, pinned to the Flash model. Capsule owns the workspace; Gemini owns the coding loop.",
    ["gemini"],
    "Install Gemini CLI on the Gateway host and give it a key: GEMINI_API_KEY, or Vertex AI. A personal Google sign-in is not accepted by current releases.",
    "https://github.com/google-gemini/gemini-cli",
    undefined,
    {
      underlyingCli: "gemini",
      configFilePath: "~/.gemini/settings.json",
      providerLocked: true,
      featured: true,
      acpxCommand: { command: "gemini", args: ["--acp", "--model", GEMINI_FLASH_MODEL] },
    },
  ),
  preset(
    "gemini",
    "Gemini CLI",
    "Google Gemini CLI in its own ACP mode, on whichever model the CLI defaults to.",
    ["gemini"],
    "Install Gemini CLI on the Gateway host and give it a key: GEMINI_API_KEY, or Vertex AI. A personal Google sign-in is not accepted by current releases.",
    "https://github.com/google-gemini/gemini-cli",
    undefined,
    {
      underlyingCli: "gemini",
      configFilePath: "~/.gemini/settings.json",
      providerLocked: true,
      acpxCommand: { command: "gemini", args: ["--acp"] },
    },
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
  return value === "claude" || value === "codex" || value === "grok";
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
    parts.push(`--cwd ${acpCwdToken(options.cwd)}`);
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

/*
 * Every /acp option command takes an optional session target:
 *
 *   /acp permissions <profile> [session-key|session-id|session-label]
 *
 * Omitting it only works when the command is sent to the session it should
 * affect *and* that session still reaches the Gateway's slash parser. An
 * ACP-bound session does not — a message sent there goes to the agent — so an
 * untargeted option command sent into an ACP session is silently inert. Always
 * name the target and send option commands to a plain Gateway session.
 */
function withTarget(command: string, target?: string): string {
  return target ? `${command} ${quoteAcpArg(target)}` : command;
}

export function acpModelCommand(model: string, target?: string): string {
  return withTarget(`/acp model ${quoteAcpArg(model)}`, target);
}

export function acpPermissionsCommand(profile: string, target?: string): string {
  const mapped = acpxPermissionMode(profile as HarnessPermissionProfile);
  return withTarget(`/acp permissions ${quoteAcpArg(mapped)}`, target);
}

export function acpCwdCommand(cwd: string, target?: string): string {
  return withTarget(`/acp cwd ${acpCwdToken(cwd)}`, target);
}

/** The adapter resolves local folder aliases before calling these builders. */
function acpCwdToken(cwd: string): string {
  if (!cwd || /[\s\0]/.test(cwd)) {
    throw new Error("Gateway cwd must be a single whitespace-free token; resolve a folder alias before building the command.");
  }
  // This is not a shell: quotes, backslashes and dollar signs are literal.
  return cwd;
}

export function acpSetModeCommand(mode: string, target?: string): string {
  return withTarget(`/acp set-mode ${quoteAcpArg(mode)}`, target);
}

export function acpTimeoutCommand(seconds: string | number, target?: string): string {
  return withTarget(`/acp timeout ${seconds}`, target);
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

export function acpOptionCommand(
  key: HarnessOptionKey,
  value: string,
  target?: string,
): string {
  if (key === "model") return acpModelCommand(value, target);
  if (key === "permissions") return acpPermissionsCommand(value, target);
  if (key === "cwd") return acpCwdCommand(value, target);
  if (key === "timeout") return acpTimeoutCommand(value, target);
  return acpSetModeCommand(value, target);
}

function availableModelsFromUnknown(value: unknown): AcpModelCatalog["availableModels"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ modelId: entry, name: entry }];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const model = entry as Record<string, unknown>;
    const modelId = [model.modelId, model.value, model.id].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    );
    if (modelId) {
      const name = typeof model.name === "string" && model.name ? model.name : modelId;
      return [{ modelId, name }];
    }
    return availableModelsFromUnknown(model.options);
  });
}

function modelCatalogFromUnknown(value: unknown): AcpModelCatalog | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const currentModelId =
    typeof record.currentModelId === "string"
      ? record.currentModelId
      : typeof record.currentValue === "string"
        ? record.currentValue
        : undefined;
  const rawModels = Array.isArray(record.availableModels)
    ? record.availableModels
    : Array.isArray(record.availableModelIds)
      ? record.availableModelIds
      : undefined;
  if (!rawModels) return undefined;
  const availableModels = availableModelsFromUnknown(rawModels);
  if (!currentModelId && availableModels.length === 0) return undefined;
  return { currentModelId, availableModels };
}

function modelCatalogFromConfigOptions(value: unknown): AcpModelCatalog | undefined {
  if (!Array.isArray(value)) return undefined;
  const option = value.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return record.id === "model" || record.category === "model";
  });
  if (!option || typeof option !== "object" || Array.isArray(option)) return undefined;
  const record = option as Record<string, unknown>;
  const direct = modelCatalogFromUnknown({
    currentValue: record.currentValue,
    availableModels: record.options,
  });
  return direct?.availableModels.length ? direct : undefined;
}

function statusJsonLine(text: string, label: string): Record<string, unknown> | undefined {
  const line = text.match(new RegExp(`^${label}:\\s*(\\{.*\\})$`, "im"))?.[1];
  if (!line) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseAcpStatus(text: string): AcpStatusSnapshot {
  const pick = (label: string) => {
    const match = text.match(new RegExp(`(?:^|\\s)${label}\\s*[:=\\-]\\s*([^,\\s]+)`, "i"));
    return match?.[1]?.replace(/[,"']+$/, "");
  };
  const runtimeDetails = statusJsonLine(text, "runtimeDetails");
  const modelLine = statusJsonLine(text, "models");
  const models =
    modelCatalogFromUnknown(modelLine) ??
    modelCatalogFromUnknown(runtimeDetails?.models) ??
    modelCatalogFromConfigOptions(runtimeDetails?.configOptions);
  return {
    backend: pick("backend"),
    mode: pick("sessionMode") ?? pick("mode"),
    state: pick("state") ?? pick("status"),
    model: pick("model") ?? models?.currentModelId,
    cwd: pick("cwd") ?? pick("working.?directory"),
    permissions: pick("permissions") ?? pick("permission.?profile") ?? pick("approval.?policy"),
    timeout: pick("timeoutSeconds") ?? pick("timeout"),
    thinking: pick("thinking") ?? pick("reasoning.?effort"),
    models,
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

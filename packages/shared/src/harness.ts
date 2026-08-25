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
  | "missing_acpx"
  | "gateway_offline"
  | "dedicated"
  | "running";

export type AcpMode = "persistent" | "oneshot";

export type HarnessPermissionProfile = "default" | "strict" | "approve-all";

export const PERMISSION_PROFILES: Array<{ id: HarnessPermissionProfile; label: string; detail: string }> = [
  { id: "strict", label: "Supervised", detail: "Ask before commands and file changes" },
  { id: "default", label: "Standard", detail: "Routine work proceeds; risky actions still ask" },
  { id: "approve-all", label: "Full access", detail: "Commands and edits without prompts" },
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
): HarnessPreset {
  return { id, name, description, openclawAgentId: id, binaries, installHint, installUrl };
}

export const PRESET_HARNESSES: HarnessPreset[] = [
  preset(
    "claude",
    "Claude Code",
    "Anthropic Claude Code through OpenClaw ACP (acpx). Capsule owns the workspace; Claude owns the coding loop.",
    ["claude"],
    "Authenticate Claude Code on the OpenClaw Gateway host. Capsule does not install it.",
    "https://claude.ai/code",
  ),
  preset(
    "codex",
    "Codex",
    "Explicit Codex ACP fallback. Prefer native /codex on the Gateway when that plugin is enabled; dedicate Codex here to force the ACP path.",
    ["codex"],
    "Authenticate the Codex CLI on the Gateway host. Native /codex is a different route from /acp spawn codex.",
    "https://developers.openai.com/codex/cli",
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

export function acpSpawnCommand(
  id: HarnessId,
  options: { cwd?: string; mode?: AcpMode; bind?: "here" | "off"; label?: string } = {},
): string {
  const bind = options.bind ?? "here";
  const mode = options.mode ?? "persistent";
  const parts = [`/acp spawn ${id}`, `--bind ${bind}`, `--mode ${mode}`];
  if (options.cwd) parts.push(`--cwd ${quoteAcpArg(options.cwd)}`);
  if (options.label) parts.push(`--label ${quoteAcpArg(options.label)}`);
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
  return `/acp permissions ${quoteAcpArg(profile)}`;
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

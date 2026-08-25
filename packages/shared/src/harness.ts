export type HarnessId = "claude" | "codex";

export type HarnessReadiness =
  | "ready"
  | "missing_cli"
  | "missing_acpx"
  | "gateway_offline"
  | "dedicated"
  | "running";

export type AcpMode = "persistent" | "oneshot";

export type HarnessPermissionProfile = "default" | "strict" | "approve-all";

export type HarnessSessionState =
  | "idle"
  | "spawning"
  | "running"
  | "waiting"
  | "closed"
  | "error";

export type HarnessOptionKey = "model" | "permissions" | "cwd" | "mode";

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

export const PRESET_HARNESSES: HarnessPreset[] = [
  {
    id: "claude",
    name: "Claude Code",
    description:
      "Anthropic Claude Code through OpenClaw ACP (acpx). Capsule owns the workspace; Claude owns the coding loop.",
    openclawAgentId: "claude",
    binaries: ["claude"],
    installHint: "Install Claude Code and authenticate on this Mac, then enable @openclaw/acpx on the Gateway.",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "codex",
    name: "Codex",
    description:
      "OpenAI Codex through explicit ACP. Native /codex is preferred on the Gateway when that plugin is enabled; Capsule uses ACP when you dedicate Codex here.",
    openclawAgentId: "codex",
    binaries: ["codex"],
    installHint: "Install the Codex CLI and authenticate on this Mac, then enable @openclaw/acpx on the Gateway.",
    installUrl: "https://github.com/openai/codex",
  },
];

export const HARNESS_PERMISSION_PROFILES: HarnessPermissionProfile[] = [
  "default",
  "strict",
  "approve-all",
];

export const ACP_MODES: AcpMode[] = ["persistent", "oneshot"];

export function isHarnessId(value: string | undefined): value is HarnessId {
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

export function acpOptionCommand(key: HarnessOptionKey, value: string): string {
  if (key === "model") return acpModelCommand(value);
  if (key === "permissions") return acpPermissionsCommand(value);
  if (key === "cwd") return acpCwdCommand(value);
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
  };
}

export function isAcpSessionKey(key: string | undefined): boolean {
  return Boolean(key && (key.includes(":acp:") || key.startsWith("acp:")));
}

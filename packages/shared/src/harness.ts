export type HarnessId = "claude" | "codex";

export type HarnessReadiness =
  | "ready"
  | "missing_cli"
  | "missing_acpx"
  | "gateway_offline"
  | "running";

export interface HarnessPreset {
  id: HarnessId;
  name: string;
  description: string;
  /** OpenClaw ACP target id (`/acp spawn <id>`). */
  openclawAgentId: string;
  binaries: string[];
  installHint: string;
}

export interface HarnessStatus extends HarnessPreset {
  readiness: HarnessReadiness;
  binaryPath?: string;
  acpxEnabled: boolean;
  dedicatedProjectIds: string[];
  detail: string;
}

export const PRESET_HARNESSES: HarnessPreset[] = [
  {
    id: "claude",
    name: "Claude Code",
    description:
      "Dedicated Anthropic Claude Code session through OpenClaw ACP (acpx), same class as Buzz's Claude runtime.",
    openclawAgentId: "claude",
    binaries: ["claude"],
    installHint: "Install Claude Code and authenticate on this Mac, then enable @openclaw/acpx on the Gateway.",
  },
  {
    id: "codex",
    name: "Codex",
    description:
      "Dedicated OpenAI Codex ACP session through OpenClaw. Native /codex is preferred on the Gateway when that plugin is enabled; Capsule uses explicit ACP when you dedicate Codex here.",
    openclawAgentId: "codex",
    binaries: ["codex"],
    installHint: "Install the Codex CLI and authenticate on this Mac, then enable @openclaw/acpx on the Gateway.",
  },
];

export function isHarnessId(value: string): value is HarnessId {
  return value === "claude" || value === "codex";
}

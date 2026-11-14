import type { HarnessStatus, SessionRef } from "@capsule/shared";

export const GATEWAY_CONNECTION_REQUIRED = "Connect the OpenClaw Gateway before starting this harness.";

export function harnessPreflightReason(input: {
  harness?: HarnessStatus;
  connected: boolean;
  folder?: string;
  live: boolean;
  session?: SessionRef;
}): string | undefined {
  if (!input.harness || input.live) return undefined;
  if (!input.folder) return "Choose a project folder before starting this harness.";
  const direct = input.session?.directSession?.harnessId === input.harness.id || input.harness.runtimeRoute === "direct";
  if (!direct && (!input.connected || input.harness.readiness === "gateway_offline")) {
    return GATEWAY_CONNECTION_REQUIRED;
  }
  if (!direct && input.harness.readiness === "missing_acpx") return input.harness.detail;
  if (input.harness.readiness === "needs_login") return input.harness.detail;
  if (input.harness.readiness === "missing_cli") return input.harness.detail;
  return undefined;
}

/**
 * What the composer shows when the picked agent cannot take a turn yet, as
 * parts rather than one sentence: a short title, the one command that fixes
 * it, and whether that command signs in or installs.
 */
export interface AgentSetupNotice {
  kind: "sign-in" | "config" | "install";
  title: string;
  /** The command that fixes it, without the backticks it is quoted in. */
  command?: string;
  /** What to do when there is no single command to run. */
  detail?: string;
}

/** The command quoted in a preset's hint: "Run `codex login`" → "codex login". */
export function quotedCommand(hint: string | undefined): string | undefined {
  return hint?.match(/`([^`\n]+)`/)?.[1]?.trim() || undefined;
}

export function agentSetupNotice(harness: HarnessStatus | undefined, reason: string | undefined): AgentSetupNotice | undefined {
  if (!harness || !reason || reason !== harness.detail) return undefined;
  if (harness.readiness === "needs_login") {
    if (harness.loginState === "config_invalid") {
      return { kind: "config", title: `${harness.name}'s settings could not be read`, detail: "Fix its config file, then check again." };
    }
    return { kind: "sign-in", title: `${harness.name} isn't signed in`, command: quotedCommand(harness.loginHint) };
  }
  if (harness.readiness === "missing_cli") {
    return { kind: "install", title: `${harness.name} isn't installed`, detail: harness.detail.replace(/`/g, "") };
  }
  return undefined;
}

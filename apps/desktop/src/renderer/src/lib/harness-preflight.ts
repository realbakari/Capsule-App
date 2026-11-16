import type { HarnessStatus, SessionRef } from "@capsule/shared";

export const GATEWAY_CONNECTION_REQUIRED = "Connect to the Gateway to start this agent.";
export const FOLDER_REQUIRED = "Attach a folder so the agent has somewhere to work.";

/*
 * Why the agent can't take a turn, in a few words. A preset's `detail` is a
 * diagnosis written for the Agents view (paths, plugin names, commands); the
 * composer only needs to say what is wrong.
 */
export function agentReadinessReason(harness: HarnessStatus): string | undefined {
  switch (harness.readiness) {
    case "missing_cli": return `${harness.name} isn't installed.`;
    case "needs_login": return harness.loginState === "config_invalid" ? `${harness.name}'s settings could not be read.` : `${harness.name} isn't signed in.`;
    case "missing_acpx": return `${harness.name} can't start.`;
    default: return undefined;
  }
}

export function harnessPreflightReason(input: {
  harness?: HarnessStatus;
  connected: boolean;
  folder?: string;
  live: boolean;
  session?: SessionRef;
}): string | undefined {
  if (!input.harness || input.live) return undefined;
  if (!input.folder) return FOLDER_REQUIRED;
  const direct = input.session?.directSession?.harnessId === input.harness.id || input.harness.runtimeRoute === "direct";
  if (!direct && (!input.connected || input.harness.readiness === "gateway_offline")) {
    return GATEWAY_CONNECTION_REQUIRED;
  }
  if (direct && input.harness.readiness === "missing_acpx") return undefined;
  return agentReadinessReason(input.harness);
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
  if (!harness || !reason || reason !== agentReadinessReason(harness)) return undefined;
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

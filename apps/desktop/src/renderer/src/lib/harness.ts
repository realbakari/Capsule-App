import { harnessCapabilities, type HarnessLiveStatus, type HarnessStatus, type SessionRef } from "@capsule/shared";

/**
 * Whether a message can go into the running turn now. Direct mode cannot
 * steer, and steering is a desktop write a paired device does not hold.
 */
export function canSteerTurn(input: { harness?: HarnessStatus; session?: SessionRef; status?: HarnessLiveStatus; desktop: boolean }): boolean {
  return input.desktop && harnessCapabilities(input).steer.state !== "unavailable";
}

export function gatewayConnectionLabel(connected: boolean, state?: string): string {
  if (connected) return "Connected to the Gateway";
  if (state === "connecting") return "Connecting to the Gateway…";
  return "Not connected to the Gateway";
}

/*
 * Renderer-side projections of harness catalog facts.
 *
 * These read the harness list Capsule already receives over IPC rather than
 * importing the catalog from @capsule/shared. The catalog is projected to the
 * frontend, never imported into it, so there is still one source of truth in
 * the main process.
 */

/**
 * The display name for a harness id. Components must not branch on the id —
 * `harnessId === "codex" ? "Codex" : "Claude Code"` silently mislabels every
 * other ACP target as Claude Code.
 */
export function harnessDisplayName(
  harnesses: readonly HarnessStatus[],
  id: string | undefined,
  fallback = "Agent",
): string {
  if (!id) return fallback;
  return harnesses.find((harness) => harness.id === id)?.name ?? fallback;
}

/** Harnesses surfaced in the main Runtimes list rather than under "Other ACP targets". */
export function isFeaturedHarness(harness: { featured?: boolean }): boolean {
  return harness.featured === true;
}

/**
 * What a row in the agent picker says under the name. The harness catalog's
 * own `detail` is written for the Harnesses screen — it names install paths
 * and tells you to dedicate or spawn, which is not what you are deciding
 * while picking an agent to talk to.
 */
export function agentPickerDetail(input: {
  harness?: HarnessStatus;
  description?: string;
  live?: boolean;
}): string | undefined {
  if (input.live) return "Running in this conversation";
  if (!input.harness) return input.description;
  return harnessReadinessLabel(input.harness.readiness);
}

/**
 * The readiness enum in words. Printed raw it reads as "missing cli" and
 * "gateway offline", which name the check rather than the situation.
 */
export function harnessReadinessLabel(readiness: HarnessStatus["readiness"]): string {
  switch (readiness) {
    case "ready":
      return "Ready";
    case "dedicated":
      // Default for some project, which may not be the one on screen; the caller adds that when it is.
      return "Ready";
    case "running":
      return "Running";
    case "missing_cli":
      return "Not installed on this computer";
    case "needs_login":
      return "Signed out";
    case "missing_acpx":
      return "The Gateway has no acpx plugin";
    case "gateway_offline":
      return "Not connected to the Gateway";
    default:
      return readiness;
  }
}

/**
 * What sending will do when the thread is live on one agent and another is
 * picked. Switching closes the running session, which is worth saying before
 * it happens rather than after.
 */
export function agentSwitchNotice(input: {
  fromName?: string;
  toName?: string;
  live: boolean;
}): string | undefined {
  if (!input.live || !input.fromName || !input.toName || input.fromName === input.toName) {
    return undefined;
  }
  return `Sending closes ${input.fromName} in this conversation and starts ${input.toName}.`;
}

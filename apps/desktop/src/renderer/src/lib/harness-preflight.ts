import type { HarnessStatus } from "@capsule/shared";

export function harnessPreflightReason(input: {
  harness?: HarnessStatus;
  connected: boolean;
  folder?: string;
  live: boolean;
}): string | undefined {
  if (!input.harness || input.live) return undefined;
  if (!input.folder) return "Choose a project folder before starting this harness.";
  if (input.harness.runtimeRoute !== "direct" && (!input.connected || input.harness.readiness === "gateway_offline")) {
    return "Connect the OpenClaw Gateway before starting this harness.";
  }
  if (input.harness.readiness === "missing_acpx") return input.harness.detail;
  if (input.harness.readiness === "needs_login") return input.harness.detail;
  if (input.harness.readiness === "missing_cli") return input.harness.detail;
  return undefined;
}

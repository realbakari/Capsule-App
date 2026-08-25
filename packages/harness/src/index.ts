import { spawnSync } from "node:child_process";
import {
  PRESET_HARNESSES,
  type HarnessId,
  type HarnessPreset,
  type HarnessReadiness,
  type HarnessStatus,
} from "@capsule/shared";

export { PRESET_HARNESSES };

export function whichBinary(binaries: string[]): string | undefined {
  const finder = process.platform === "win32" ? "where" : "which";
  for (const binary of binaries) {
    const result = spawnSync(finder, [binary], { encoding: "utf8" });
    if (result.status === 0) {
      const line = result.stdout.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
      if (line) return line;
    }
  }
  return undefined;
}

export function describeReadiness(input: {
  preset: HarnessPreset;
  binaryPath?: string;
  gatewayConnected: boolean;
  acpxEnabled: boolean;
  dedicated: boolean;
}): { readiness: HarnessReadiness; detail: string } {
  if (!input.binaryPath) {
    return { readiness: "missing_cli", detail: input.preset.installHint };
  }
  if (!input.gatewayConnected) {
    return {
      readiness: "gateway_offline",
      detail: `${input.preset.name} is installed. Connect OpenClaw to spawn an ACP session.`,
    };
  }
  if (!input.acpxEnabled) {
    return {
      readiness: "missing_acpx",
      detail: "Enable the OpenClaw acpx plugin: openclaw plugins install @openclaw/acpx",
    };
  }
  return {
    readiness: input.dedicated ? "running" : "ready",
    detail: input.dedicated
      ? `${input.preset.name} is dedicated to this workspace and can take coding sessions.`
      : `${input.preset.name} is ready. Dedicate it to a project to route code work through ACP.`,
  };
}

export function probeHarnesses(input: {
  gatewayConnected: boolean;
  acpxEnabled: boolean;
  dedicatedByHarness: Record<string, string[]>;
}): HarnessStatus[] {
  return PRESET_HARNESSES.map((preset) => {
    const binaryPath = whichBinary(preset.binaries);
    const dedicatedProjectIds = input.dedicatedByHarness[preset.id] ?? [];
    const { readiness, detail } = describeReadiness({
      preset,
      binaryPath,
      gatewayConnected: input.gatewayConnected,
      acpxEnabled: input.acpxEnabled,
      dedicated: dedicatedProjectIds.length > 0,
    });
    return {
      ...preset,
      readiness,
      binaryPath,
      acpxEnabled: input.acpxEnabled,
      dedicatedProjectIds,
      detail,
    };
  });
}

export function acpSpawnCommand(id: HarnessId, cwd?: string): string {
  const cwdFlag = cwd ? ` --cwd ${cwd}` : "";
  return `/acp spawn ${id} --bind here --mode persistent${cwdFlag}`;
}

export function harnessAgentRecord(preset: HarnessPreset) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    runtime: "openclaw" as const,
    model: preset.openclawAgentId,
    skills: ["coding"],
    tools: ["acp"],
    permissions: {
      filesystem: "approval" as const,
      terminal: "approval" as const,
      network: "allow" as const,
    },
    status: "idle" as const,
    kind: "agent" as const,
    recentRunIds: [],
  };
}

import { spawnSync } from "node:child_process";
import {
  PRESET_HARNESSES,
  type HarnessDoctorCheck,
  type HarnessDoctorReport,
  type HarnessId,
  type HarnessPreset,
  type HarnessReadiness,
  type HarnessStatus,
  isHarnessId,
} from "@capsule/shared";

export {
  ACP_MODES,
  HARNESS_PERMISSION_PROFILES,
  PRESET_HARNESSES,
  acpCancelCommand,
  acpCloseCommand,
  acpCwdCommand,
  acpDoctorCommand,
  acpModelCommand,
  acpOptionCommand,
  acpPermissionsCommand,
  acpSessionsCommand,
  acpSetModeCommand,
  acpSpawnCommand,
  acpStatusCommand,
  acpSteerCommand,
  isAcpSessionKey,
  isHarnessId,
  parseAcpStatus,
  quoteAcpArg,
} from "@capsule/shared";

export function whichBinary(binaries: string[]): string | undefined {
  const finder = process.platform === "win32" ? "where" : "which";
  for (const binary of binaries) {
    const result = spawnSync(finder, [binary], { encoding: "utf8" });
    if (result.status === 0) {
      const line = result.stdout
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find(Boolean);
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
  live: boolean;
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
  if (input.live) {
    return {
      readiness: "running",
      detail: `${input.preset.name} has a live ACP session. Follow-ups, steer, cancel, and close go through this harness.`,
    };
  }
  if (input.dedicated) {
    return {
      readiness: "dedicated",
      detail: `${input.preset.name} is dedicated to this workspace. Spawn a session or send code work to start ACP.`,
    };
  }
  return {
    readiness: "ready",
    detail: `${input.preset.name} is ready. Dedicate it to a project to route code work through ACP.`,
  };
}

export function probeHarnesses(input: {
  gatewayConnected: boolean;
  acpxEnabled: boolean;
  dedicatedByHarness: Record<string, string[]>;
  liveByHarness?: Record<string, string[]>;
}): HarnessStatus[] {
  return PRESET_HARNESSES.map((preset) => {
    const binaryPath = whichBinary(preset.binaries);
    const dedicatedProjectIds = input.dedicatedByHarness[preset.id] ?? [];
    const liveSessionIds = input.liveByHarness?.[preset.id] ?? [];
    const { readiness, detail } = describeReadiness({
      preset,
      binaryPath,
      gatewayConnected: input.gatewayConnected,
      acpxEnabled: input.acpxEnabled,
      dedicated: dedicatedProjectIds.length > 0,
      live: liveSessionIds.length > 0,
    });
    return {
      ...preset,
      readiness,
      binaryPath,
      acpxEnabled: input.acpxEnabled,
      dedicatedProjectIds,
      liveSessionIds,
      detail,
    };
  });
}

export function localDoctorChecks(input: {
  preset: HarnessPreset;
  binaryPath?: string;
  gatewayConnected: boolean;
  acpxEnabled: boolean;
}): HarnessDoctorCheck[] {
  return [
    {
      id: "cli",
      label: `${input.preset.name} CLI`,
      ok: Boolean(input.binaryPath),
      detail: input.binaryPath ?? input.preset.installHint,
    },
    {
      id: "gateway",
      label: "OpenClaw Gateway",
      ok: input.gatewayConnected,
      detail: input.gatewayConnected
        ? "Operator client is connected."
        : "Connect the Gateway before spawning ACP sessions.",
    },
    {
      id: "acpx",
      label: "acpx plugin",
      ok: input.acpxEnabled,
      detail: input.acpxEnabled
        ? "@openclaw/acpx is enabled on the Gateway."
        : "openclaw plugins install @openclaw/acpx",
    },
  ];
}

export function buildDoctorReport(input: {
  harnessId: HarnessId;
  checks: HarnessDoctorCheck[];
  gatewayOutput?: string;
}): HarnessDoctorReport {
  return {
    harnessId: input.harnessId,
    ready: input.checks.every((check) => check.ok),
    checks: input.checks,
    gatewayOutput: input.gatewayOutput,
  };
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

export function presetFor(id: string): HarnessPreset | undefined {
  if (!isHarnessId(id)) return undefined;
  return PRESET_HARNESSES.find((preset) => preset.id === id);
}

export function isLiveHarnessState(state: string | undefined): boolean {
  return state === "spawning" || state === "running" || state === "waiting";
}

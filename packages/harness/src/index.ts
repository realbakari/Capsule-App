import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  ACP_HARNESS_IDS,
  ACP_MODES,
  HARNESS_PERMISSION_PROFILES,
  PRIMARY_HARNESS_IDS,
  PRESET_HARNESSES,
  acpCancelCommand,
  acpCloseCommand,
  acpCwdCommand,
  acpDoctorCommand,
  acpInstallCommand,
  acpModelCommand,
  acpOptionCommand,
  acpPermissionsCommand,
  acpResetOptionsCommand,
  acpSessionsCommand,
  acpSetCommand,
  acpSetModeCommand,
  acpSpawnCommand,
  acpStatusCommand,
  acpSteerCommand,
  acpTimeoutCommand,
  isAcpSessionKey,
  isHarnessId,
  isPrimaryHarness,
  parseAcpStatus,
  quoteAcpArg,
} from "@capsule/shared";

export function extraBinDirs(): string[] {
  const home = os.homedir();
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "bin"),
    path.join(home, ".codex", "bin"),
    path.join(home, ".cursor", "bin"),
    path.join(home, ".gemini", "bin"),
    path.join(home, ".local", "share", "fnm", "current", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".nvm", "current", "bin"),
  ];
}

function whichOnPath(binary: string): string | undefined {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [binary], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
}

function whichViaLoginShell(binary: string): string | undefined {
  if (process.platform === "win32") return undefined;
  if (process.env.VITEST) return undefined;
  const shell = process.env.SHELL || "/bin/zsh";
  const result = spawnSync(shell, ["-lic", `command -v ${binary}`], {
    encoding: "utf8",
    timeout: 2500,
  });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
}

export function whichBinary(binaries: string[]): string | undefined {
  for (const binary of binaries) {
    const fromPath = whichOnPath(binary);
    if (fromPath) return fromPath;
    for (const dir of extraBinDirs()) {
      const candidate = path.join(dir, binary);
      if (existsSync(candidate)) return candidate;
    }
    const fromShell = whichViaLoginShell(binary);
    if (fromShell) return fromShell;
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
  if (input.live) {
    return {
      readiness: "running",
      detail: `${input.preset.name} is on a live ACP session.`,
    };
  }
  if (input.gatewayConnected && input.acpxEnabled) {
    if (input.dedicated) {
      return {
        readiness: "dedicated",
        detail: input.binaryPath
          ? `Detected ${input.binaryPath}. Code work in this project routes through ${input.preset.name}.`
          : `${input.preset.name} is dedicated. OpenClaw will spawn it on the Gateway host.`,
      };
    }
    return {
      readiness: "ready",
      detail: input.binaryPath
        ? `Detected ${input.binaryPath}. Dedicate it or spawn a session — Capsule will not install another copy.`
        : `${input.preset.name} is available through OpenClaw on the Gateway host. You do not install it inside Capsule.`,
    };
  }
  if (!input.gatewayConnected) {
    return {
      readiness: "gateway_offline",
      detail: input.binaryPath
        ? `Detected ${input.preset.name} at ${input.binaryPath}. Start the OpenClaw Gateway to spawn a session.`
        : `Start the OpenClaw Gateway. Capsule will pick up ${input.preset.name} from this Mac or the Gateway host — it is not installed in the app.`,
    };
  }
  return {
    readiness: "missing_acpx",
    detail: "Enable ACP on the Gateway: openclaw plugins install @openclaw/acpx",
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
      label: `${input.preset.name} on this Mac`,
      ok: Boolean(input.binaryPath) || (input.gatewayConnected && input.acpxEnabled),
      detail: input.binaryPath
        ? `Picked up ${input.binaryPath}`
        : input.gatewayConnected && input.acpxEnabled
          ? "No local binary on PATH. OpenClaw can still spawn it on the Gateway host."
          : input.preset.installHint,
    },
    {
      id: "gateway",
      label: "OpenClaw Gateway",
      ok: input.gatewayConnected,
      detail: input.gatewayConnected
        ? "Connected."
        : "Gateway is not running. Capsule looks for it at the configured URL (default ws://127.0.0.1:18789).",
    },
    {
      id: "acpx",
      label: "ACP (acpx)",
      ok: input.acpxEnabled,
      detail: input.acpxEnabled
        ? "acpx is enabled. ACP runs on the Gateway host, not inside the OpenClaw sandbox."
        : "openclaw plugins install @openclaw/acpx && openclaw config set plugins.entries.acpx.enabled true. If plugins.allow is set, it must include acpx.",
    },
  ];
}

export function buildDoctorReport(input: {
  harnessId: HarnessId;
  checks: HarnessDoctorCheck[];
  gatewayOutput?: string;
}): HarnessDoctorReport {
  const gateway = input.checks.find((check) => check.id === "gateway")?.ok ?? false;
  const acpx = input.checks.find((check) => check.id === "acpx")?.ok ?? false;
  return {
    harnessId: input.harnessId,
    ready: gateway && acpx,
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

export function canSpawnHarness(readiness: HarnessReadiness): boolean {
  return readiness === "ready" || readiness === "dedicated" || readiness === "running";
}

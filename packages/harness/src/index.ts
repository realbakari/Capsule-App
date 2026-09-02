import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PRESET_HARNESSES,
  type HarnessLoginState,
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
    path.join(home, ".grok", "bin"),
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

function locateBinary(binary: string): string | undefined {
  const fromPath = whichOnPath(binary);
  if (fromPath) return fromPath;
  for (const dir of extraBinDirs()) {
    const candidate = path.join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return whichViaLoginShell(binary);
}

/*
 * Locating a binary costs a synchronous `which`, and on a miss a login shell
 * with a 2.5s timeout — all blocking the Electron main process, and with it
 * every IPC call. probeHarnesses runs it per preset on every refresh, and
 * refresh fires on every connection/run/approval event. Resolve each binary
 * once per process instead; the Doctor action clears the cache.
 */
const binaryPathCache = new Map<string, string | undefined>();

export function clearBinaryCache(): void {
  binaryPathCache.clear();
}

export function whichBinary(binaries: string[]): string | undefined {
  for (const binary of binaries) {
    let resolved: string | undefined;
    if (binaryPathCache.has(binary)) {
      resolved = binaryPathCache.get(binary);
      if (resolved && !existsSync(resolved)) {
        resolved = locateBinary(binary);
        binaryPathCache.set(binary, resolved);
      }
    } else {
      resolved = locateBinary(binary);
      binaryPathCache.set(binary, resolved);
    }
    if (resolved) return resolved;
  }
  return undefined;
}

/*
 * Sign-in probing, modelled on how Buzz gates its harnesses: ask the CLI
 * itself (`claude auth status`, `codex login status`) before a run rather than
 * letting a turn fail mid-flight with an opaque "Authentication required".
 *
 * Capsule never reads credentials — it only reads the CLI's exit code.
 */

/** Stderr signals that mean "your config file is broken", not "logged out". */
const CONFIG_INVALID_SIGNALS = ["parse", "config"];

/**
 * Pure classification so the decision is testable without spawning anything.
 *
 * Exit status alone is NOT sufficient: `claude auth status` exits 0 whether or
 * not you are signed in, and reports the answer in a JSON body
 * (`{"loggedIn": false, ...}`). `codex login status` exits 0 too and answers in
 * prose ("Logged in using ChatGPT"). So read the output first and only fall
 * back to the exit code when the output says nothing recognisable.
 */
export function classifyLoginProbe(input: {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  spawnFailed?: boolean;
}): HarnessLoginState {
  // A probe we could not run at all tells us nothing; claiming "logged out"
  // would block a harness that is actually fine.
  if (input.spawnFailed) return "unknown";

  const stdout = (input.stdout ?? "").trim();
  if (stdout) {
    const structured = readStructuredLoginFlag(stdout);
    if (structured !== undefined) return structured ? "logged_in" : "logged_out";
    const lower = stdout.toLowerCase();
    if (/\bnot logged in\b|\bnot signed in\b|\blogged out\b|\bplease run\b/.test(lower)) {
      return "logged_out";
    }
    if (/\blogged in\b|\bsigned in\b|\bauthenticated\b/.test(lower)) return "logged_in";
  }

  const stderr = (input.stderr ?? "").toLowerCase();
  if (stderr && CONFIG_INVALID_SIGNALS.every((signal) => stderr.includes(signal))) {
    return "config_invalid";
  }
  return input.ok ? "logged_in" : "logged_out";
}

/** Reads a `loggedIn`-style boolean out of a JSON probe body, if present. */
function readStructuredLoginFlag(stdout: string): boolean | undefined {
  if (!stdout.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    for (const key of ["loggedIn", "logged_in", "authenticated", "isLoggedIn"]) {
      if (typeof record[key] === "boolean") return record[key];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const LOGIN_PROBE_TIMEOUT_MS = 5_000;
const LOGIN_CACHE_TTL_MS = 60_000;

const loginStateCache = new Map<string, { state: HarnessLoginState; at: number }>();

export function clearLoginCache(): void {
  loginStateCache.clear();
}

/**
 * Runs a preset's login probe, cached briefly. probeHarnesses runs on every
 * refresh, and refresh fires on every connection/run/approval event, so an
 * uncached spawn here would be the same main-process stall that whichBinary
 * used to cause.
 */
export function probeLoginState(preset: HarnessPreset, binaryPath?: string): HarnessLoginState | undefined {
  if (!preset.loginProbeArgs || !binaryPath) return undefined;
  const key = `${preset.id}:${binaryPath}`;
  const cached = loginStateCache.get(key);
  if (cached && Date.now() - cached.at < LOGIN_CACHE_TTL_MS) return cached.state;
  if (process.env.VITEST) return undefined;

  let state: HarnessLoginState;
  try {
    const result = spawnSync(binaryPath, preset.loginProbeArgs, {
      encoding: "utf8",
      timeout: LOGIN_PROBE_TIMEOUT_MS,
    });
    state = classifyLoginProbe({
      ok: result.status === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      spawnFailed: Boolean(result.error) || result.status === null,
    });
  } catch {
    state = "unknown";
  }
  loginStateCache.set(key, { state, at: Date.now() });
  return state;
}

export function describeReadiness(input: {
  preset: HarnessPreset;
  binaryPath?: string;
  gatewayConnected: boolean;
  acpxEnabled: boolean;
  dedicated: boolean;
  live: boolean;
  loginState?: HarnessLoginState;
}): { readiness: HarnessReadiness; detail: string } {
  if (input.live) {
    return {
      readiness: "running",
      detail: `${input.preset.name} is on a live ACP session.`,
    };
  }
  if (input.gatewayConnected && input.acpxEnabled) {
    if (input.loginState === "config_invalid") {
      return {
        readiness: "needs_login",
        detail: `${input.preset.name}'s CLI config could not be read. Fix it, then run Doctor.`,
      };
    }
    if (input.loginState === "logged_out") {
      return {
        readiness: "needs_login",
        detail: `${input.preset.name} is installed but not signed in. ${
          input.preset.loginHint ?? "Sign in to its CLI"
        } on the Gateway host, then run Doctor.`,
      };
    }
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
    detail:
      "Enable ACP on the Gateway: openclaw plugins install @openclaw/acpx. If it is already installed, run openclaw gateway restart.",
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
    // A live session already proves auth, so do not pay for a probe.
    const loginState =
      liveSessionIds.length > 0 ? undefined : probeLoginState(preset, binaryPath);
    const { readiness, detail } = describeReadiness({
      preset,
      binaryPath,
      gatewayConnected: input.gatewayConnected,
      acpxEnabled: input.acpxEnabled,
      dedicated: dedicatedProjectIds.length > 0,
      live: liveSessionIds.length > 0,
      loginState,
    });
    return {
      ...preset,
      readiness,
      binaryPath,
      acpxEnabled: input.acpxEnabled,
      dedicatedProjectIds,
      liveSessionIds,
      detail,
      ...(loginState ? { loginState } : {}),
    };
  });
}

export function localDoctorChecks(input: {
  preset: HarnessPreset;
  binaryPath?: string;
  gatewayConnected: boolean;
  acpxEnabled: boolean;
  loginState?: HarnessLoginState;
  acpxPermissionMode?: string;
  acpxPolicyKnown?: boolean;
  acpxAgentConfigured?: boolean;
  acpxAgentError?: string;
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
    ...(input.preset.configFilePath
      ? [
          {
            id: "config",
            label: `${input.preset.name} config`,
            // Informational: Capsule does not read the harness's own config,
            // but Doctor should say where it lives when a run misbehaves.
            ok: true,
            detail: `${input.preset.configFilePath}${
              input.preset.providerLocked ? " · provider is fixed for this harness" : ""
            }`,
          },
        ]
      : []),
    ...(input.preset.loginProbeArgs
      ? [
          {
            id: "login",
            label: `${input.preset.name} sign-in`,
            ok: input.loginState === "logged_in" || input.loginState === undefined,
            detail:
              input.loginState === "logged_in"
                ? "Signed in."
                : input.loginState === "logged_out"
                  ? `${input.preset.loginHint ?? "Sign in to its CLI"} on the Gateway host.`
                  : input.loginState === "config_invalid"
                    ? "The CLI reported a broken config file."
                    : `Not checked (\`${input.preset.binaries[0]} ${(input.preset.loginProbeArgs ?? []).join(" ")}\` did not run).`,
          },
        ]
      : []),
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
    ...(input.acpxEnabled
      ? [
          {
            id: "acpx-permissions",
            label: "ACP headless tools",
            ok:
              !input.acpxPolicyKnown ||
              input.acpxPermissionMode === "approve-all" ||
              input.acpxPermissionMode === "deny-all",
            detail: !input.acpxPolicyKnown
              ? "Could not read plugin permissionMode. Spawn will set approve-all for Standard/Full, deny-all for Supervised."
              : input.acpxPermissionMode === "approve-all"
                ? "Gateway acpx is on approve-all. Standard and Full access can write and fetch without a TTY."
                : input.acpxPermissionMode === "deny-all"
                  ? "Gateway acpx is on deny-all (Supervised). Tools are refused; it never asks. Switch to Standard or Full for coding writes."
                  : "Gateway acpx is not approve-all (default is approve-reads). Writes and network die with Permission prompt unavailable. Capsule tries to set approve-all on spawn. If this stays red: openclaw config set plugins.entries.acpx.config.permissionMode approve-all && openclaw gateway restart",
          },
        ]
      : []),
    ...(input.preset.acpxCommand
      ? [
          {
            id: "acpx-agent",
            label: `${input.preset.name} ACP command`,
            ok: input.acpxAgentConfigured === true,
            detail:
              input.acpxAgentConfigured === true
                ? `Registered \`${input.preset.acpxCommand.command} ${(input.preset.acpxCommand.args ?? []).join(" ")}\` with OpenClaw acpx.`
                : input.acpxAgentError ??
                  `OpenClaw must map \`${input.preset.openclawAgentId}\` to \`${input.preset.acpxCommand.command} ${(input.preset.acpxCommand.args ?? []).join(" ")}\`. Run Doctor while the Gateway is connected.`,
          },
        ]
      : []),
  ];
}

export function buildDoctorReport(input: {
  harnessId: HarnessId;
  checks: HarnessDoctorCheck[];
  gatewayOutput?: string;
}): HarnessDoctorReport {
  const gateway = input.checks.find((check) => check.id === "gateway")?.ok ?? false;
  const acpx = input.checks.find((check) => check.id === "acpx")?.ok ?? false;
  const acpxAgent = input.checks.find((check) => check.id === "acpx-agent")?.ok ?? true;
  return {
    harnessId: input.harnessId,
    ready: gateway && acpx && acpxAgent,
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

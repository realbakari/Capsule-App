import {
  AGENT_PACKAGE_SOURCES,
  PRESET_HARNESSES,
  safeAgentEnv,
  sanitizeUntrusted,
  type AgentManagedInstall,
  type AgentPackageSource,
  type AgentStoreEntry,
  type AgentStoreOffer,
  type HarnessId,
  type HarnessPreset,
} from "@capsule/shared";

/*
 * The install planner: registry JSON, the source table and the computer in,
 * one plan per installable preset out. Pure, so every platform and every
 * malformed registry entry is testable without a network or a disk.
 */

export type PlatformKey =
  | "darwin-aarch64"
  | "darwin-x86_64"
  | "linux-aarch64"
  | "linux-x86_64"
  | "windows-aarch64"
  | "windows-x86_64";

export interface HostFacts {
  platform: NodeJS.Platform;
  arch: string;
  /** npm is on this computer. */
  hasNode: boolean;
}

export type ArchiveFormat = "tar" | "zip" | "raw";

/** Exactly what an install does. Only a plan that can install carries one. */
export type InstallRecipe =
  | {
      kind: "binary";
      version: string;
      url: string;
      sha256?: string;
      archive: ArchiveFormat;
      /** Path of the launch command inside the unpacked download, as segments. */
      entry: string[];
      env: Record<string, string>;
    }
  | { kind: "npm"; version: string; packageName: string; env: Record<string, string> };

interface PlanBase {
  harnessId: HarnessId;
  /** Display name for messages. */
  name: string;
  /** The command the preset launches, and the shim's name. */
  command: string;
  /**
   * Who owns the install folder and the shim. Presets that launch the same
   * command (Gemini and Gemini Flash) share one copy, so they share one key.
   */
  storeKey: HarnessId;
}

export type AgentPlan = PlanBase &
  (
    | { offer: AgentStoreOffer; recipe: InstallRecipe; unavailable?: undefined }
    | { offer?: AgentStoreOffer; recipe?: undefined; unavailable: string }
  );

export interface PlanInput {
  /** Parsed registry JSON, or undefined when there is none. */
  registry: unknown;
  /** Why there is no registry, in a sentence. */
  registryError?: string;
  /** npm `latest` per package name; absent when it could not be read. */
  npmLatest: Record<string, string | undefined>;
  host: HostFacts;
  sources?: Partial<Record<HarnessId, AgentPackageSource>>;
  presets?: HarnessPreset[];
}

export const NEEDS_NODE = "Needs Node.js. Install it from nodejs.org, then check again.";
export const NO_REGISTRY =
  "Capsule couldn't reach the agent registry and has no saved copy of it. Check your connection, then refresh.";

export function platformKey(platform: NodeJS.Platform, arch: string): PlatformKey | undefined {
  const os = ({ darwin: "darwin", linux: "linux", win32: "windows" } as const)[platform as "darwin" | "linux" | "win32"];
  const cpu = ({ arm64: "aarch64", x64: "x86_64" } as const)[arch as "arm64" | "x64"];
  return os && cpu ? `${os}-${cpu}` : undefined;
}

export function launchCommand(preset: HarnessPreset): string | undefined {
  return (preset.nativeCommand ?? preset.directCommand ?? preset.acpxCommand)?.command;
}

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/i;

export function isSafeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value) && !value.includes("..");
}

function untrusted(value: string): string {
  return sanitizeUntrusted(value, { singleLine: true, maxChars: 80 });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringEnv(value: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(record(value) ?? {})) if (typeof item === "string") env[key] = item;
  return safeAgentEnv(env);
}

/** Registry agents by id. Anything that is not an object with a string id is dropped. */
export function indexRegistry(registry: unknown): Map<string, Record<string, unknown>> {
  const agents = record(registry)?.agents;
  const index = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(agents)) return index;
  for (const agent of agents) {
    const entry = record(agent);
    if (entry && typeof entry.id === "string") index.set(entry.id, entry);
  }
  return index;
}

function archiveFormat(url: URL): ArchiveFormat | undefined {
  const last = url.pathname.split("/").pop()!.toLowerCase();
  if (/\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar)$/.test(last)) return "tar";
  if (last.endsWith(".zip")) return "zip";
  if (!last.includes(".") || last.endsWith(".exe")) return "raw";
  return undefined;
}

type Outcome = { recipe: InstallRecipe; offer: AgentStoreOffer } | { reason: string; offer?: AgentStoreOffer };

function binaryOutcome(target: Record<string, unknown>, version: string, plan: PlanBase, source: AgentPackageSource, key: PlatformKey): Outcome {
  const unpackable = `Capsule can't unpack the ${plan.name} download for this computer.`;
  let url: URL;
  try {
    url = new URL(String(target.archive));
  } catch {
    return { reason: unpackable };
  }
  if (url.protocol !== "https:") return { reason: `The ${plan.name} download isn't served over HTTPS, so Capsule won't install it.` };
  const archive = archiveFormat(url);
  if (!archive) return { reason: unpackable };
  const cmd = typeof target.cmd === "string" ? target.cmd : "";
  const entry = cmd.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (!entry.length || entry.includes("..") || /^([\\/]|[A-Za-z]:)/.test(cmd)) return { reason: unpackable };
  const basename = entry[entry.length - 1]!;
  const name = key.startsWith("windows-") ? basename.replace(/\.(exe|cmd|bat)$/i, "") : basename;
  if (name !== plan.command) {
    return {
      reason: `The ${plan.name} download starts \`${untrusted(basename)}\`, not \`${plan.command}\`, so Capsule can't launch it.`,
    };
  }
  const sha256 = target.sha256;
  if (sha256 !== undefined && !(typeof sha256 === "string" && SHA256.test(sha256))) {
    return { reason: `The registry lists a malformed checksum for ${plan.name}, so Capsule won't install it.` };
  }
  return {
    offer: { version, kind: "binary", source },
    recipe: {
      kind: "binary",
      version,
      url: url.href,
      ...(sha256 ? { sha256: sha256.toLowerCase() } : {}),
      archive,
      entry,
      env: stringEnv(target.env),
    },
  };
}

function npmOutcome(packageName: string, version: string, env: Record<string, string>, source: AgentPackageSource, host: HostFacts): Outcome {
  const offer: AgentStoreOffer = { version, kind: "npm", source, requires: "node" };
  if (!host.hasNode) return { offer, reason: NEEDS_NODE };
  return { offer, recipe: { kind: "npm", version, packageName, env } };
}

/** `@scope/name@1.2.3` into its name and version; the version falls back to the registry's. */
function parsePackageSpec(spec: unknown, fallback: string): { name: string; version: string } | undefined {
  if (typeof spec !== "string") return undefined;
  const at = spec.lastIndexOf("@");
  const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, fallback];
  return NPM_NAME.test(name) && isSafeVersion(version) ? { name, version } : undefined;
}

function registryOutcome(agent: Record<string, unknown>, plan: PlanBase, source: AgentPackageSource, host: HostFacts): Outcome {
  if (!isSafeVersion(agent.version)) return { reason: `The agent registry lists ${plan.name} without a usable version.` };
  const distribution = record(agent.distribution) ?? {};
  const key = platformKey(host.platform, host.arch);
  const target = key ? record(record(distribution.binary)?.[key]) : undefined;

  let binaryReason: string | undefined;
  if (target && key) {
    const outcome = binaryOutcome(target, agent.version, plan, source, key);
    if ("recipe" in outcome) return outcome;
    binaryReason = outcome.reason;
  }
  const npx = record(distribution.npx);
  if (npx) {
    const spec = parsePackageSpec(npx.package, agent.version);
    if (spec) return npmOutcome(spec.name, spec.version, stringEnv(npx.env), source, host);
    binaryReason ??= `The agent registry lists a malformed package for ${plan.name}.`;
  }
  if (record(distribution.uvx)) {
    return { offer: { version: agent.version, kind: "uvx", source, requires: "uv" }, reason: "Installing this agent from Capsule isn't supported yet." };
  }
  return { reason: binaryReason ?? `${plan.name} has no build for this computer.` };
}

export function planAgentStore(input: PlanInput): AgentPlan[] {
  const sources = input.sources ?? AGENT_PACKAGE_SOURCES;
  const presets = input.presets ?? PRESET_HARNESSES;
  const registry = input.registry === undefined ? undefined : indexRegistry(input.registry);
  const owners = new Map<string, HarnessId>();
  const plans: AgentPlan[] = [];

  for (const [harnessId, source] of Object.entries(sources) as [HarnessId, AgentPackageSource][]) {
    const preset = presets.find((item) => item.id === harnessId);
    const command = preset && launchCommand(preset);
    if (!preset || !command) continue;
    if (!owners.has(command)) owners.set(command, harnessId);
    const base: PlanBase = { harnessId, name: preset.name, command, storeKey: owners.get(command)! };

    let outcome: Outcome;
    if (source.kind === "npm") {
      const latest = input.npmLatest[source.packageName];
      outcome = isSafeVersion(latest)
        ? npmOutcome(source.packageName, latest, {}, source, input.host)
        : { reason: `Capsule couldn't check the latest version of ${preset.name}. Check your connection, then refresh.` };
    } else if (!registry) {
      outcome = { reason: input.registryError ?? NO_REGISTRY };
    } else {
      const agent = registry.get(source.registryId);
      outcome = agent
        ? registryOutcome(agent, base, source, input.host)
        : { reason: `The agent registry doesn't list ${preset.name} right now.` };
    }
    plans.push(
      "recipe" in outcome
        ? { ...base, offer: outcome.offer, recipe: outcome.recipe }
        : { ...base, ...(outcome.offer ? { offer: outcome.offer } : {}), unavailable: outcome.reason },
    );
  }
  return plans;
}

/** One plan, plus what is already on this computer, as the store shows it. */
export function storeEntry(plan: AgentPlan, installed: AgentManagedInstall | undefined, userPath: string | undefined): AgentStoreEntry {
  return {
    harnessId: plan.harnessId,
    ...(plan.offer ? { offer: plan.offer } : {}),
    ...(plan.unavailable ? { unavailable: plan.unavailable } : {}),
    ...(installed ? { installed } : {}),
    ...(userPath ? { userPath } : {}),
    ...(installed && plan.offer ? { updateAvailable: plan.offer.version !== installed.version } : {}),
  };
}

import type { HarnessId } from "./harness.js";

/*
 * Getting an agent onto this computer and signed in, from inside Capsule.
 *
 * The store installs into a folder Capsule owns and puts a shim named after
 * the preset's own launch command in its bin folder, which binary lookup
 * searches after PATH. Launching, readiness and resume therefore stay exactly
 * as they are, and a copy the user installed themselves always wins.
 */

/** Where Capsule can fetch an agent from when the user asks it to install one. */
export type AgentPackageSource =
  /** An entry in the ACP agent registry. */
  | { kind: "registry"; registryId: string }
  /** The vendor's own CLI package, for agents the registry carries only as an adapter. */
  | { kind: "npm"; packageName: string };

/*
 * The presets the store can install, and from where. A preset is here only
 * when the source provides the exact command the preset launches, so an
 * install makes that preset ready without any other change. Presets with no
 * direct launch command run only through the Gateway and are absent.
 */
export const AGENT_PACKAGE_SOURCES: Partial<Record<HarnessId, AgentPackageSource>> = {
  claude: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
  codex: { kind: "npm", packageName: "@openai/codex" },
  grok: { kind: "registry", registryId: "grok-build" },
  copilot: { kind: "registry", registryId: "github-copilot-cli" },
  cursor: { kind: "registry", registryId: "cursor" },
  gemini: { kind: "registry", registryId: "gemini" },
  "gemini-flash": { kind: "registry", registryId: "gemini" },
  kilocode: { kind: "registry", registryId: "kilo" },
  kimi: { kind: "registry", registryId: "kimi" },
  kiro: { kind: "registry", registryId: "kiro" },
  opencode: { kind: "registry", registryId: "opencode" },
  qoder: { kind: "registry", registryId: "qoder" },
  qwen: { kind: "registry", registryId: "qwen-code" },
  muse: { kind: "registry", registryId: "muse-code" },
};

export const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** How an offer installs. Registry `npx` entries install with npm, so they are `npm` here too. */
export type AgentDistributionKind = "binary" | "npm" | "uvx";

/** What the store would install for one agent on this computer. */
export interface AgentStoreOffer {
  version: string;
  kind: AgentDistributionKind;
  source: AgentPackageSource;
  /** A tool that must already be on this computer for the install to work. */
  requires?: "node" | "uv";
}

/** A copy Capsule installed and can update or remove. */
export interface AgentManagedInstall {
  version: string;
  kind: AgentDistributionKind;
  installedAt: string;
}

/** One agent as the store sees it. */
export interface AgentStoreEntry {
  harnessId: HarnessId;
  offer?: AgentStoreOffer;
  /** Why Install is unavailable here: no build for this platform, Node.js missing, registry unreachable. */
  unavailable?: string;
  installed?: AgentManagedInstall;
  /** A copy the user installed themselves. Capsule never updates or removes it. */
  userPath?: string;
  updateAvailable?: boolean;
}

export type AgentInstallPhase = "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "linking";

/** Streamed on the `agentInstallProgress` event while an install or update runs. */
export type AgentInstallProgress =
  | { harnessId: HarnessId; phase: AgentInstallPhase; detail?: string; received?: number; total?: number }
  | { harnessId: HarnessId; phase: "done"; version: string }
  | { harnessId: HarnessId; phase: "failed"; error: string };

/** One way to sign an agent in. */
export type AgentSignInMethod =
  /** The agent signs itself in when asked (ACP `authenticate`), often by opening a browser. Direct route only. */
  | { kind: "agent"; id: string; name: string; description?: string }
  /** ACP terminal auth: the same agent program, run interactively with these extra args and env. */
  | { kind: "terminal"; id: string; name: string; description?: string; argv: string[]; env?: Record<string, string> }
  /** The CLI's own login command, such as `claude auth login`. */
  | { kind: "cli"; id: "cli-login"; name: string; argv: string[] };

export interface AgentSignInOptions {
  harnessId: HarnessId;
  methods: AgentSignInMethod[];
  /** The agent advertised ACP logout. */
  canSignOut: boolean;
  /** Why the agent's own methods could not be read; CLI login may still be listed. */
  error?: string;
}

/** A login terminal Capsule started; output arrives on `terminalData`/`terminalExit` under this id. */
export interface AgentLoginTerminal {
  id: string;
  argv: string[];
}

/**
 * The CLI login command a preset names in its hint, as argv, or undefined
 * when the hint does not quote one. `Run \`claude auth login\`` gives
 * `["claude", "auth", "login"]`. Only plain words are accepted, so a hint can
 * never become a shell string.
 */
export function cliLoginArgv(loginHint: string | undefined): string[] | undefined {
  const quoted = loginHint?.match(/`([^`]+)`/)?.[1]?.trim();
  if (!quoted) return undefined;
  const argv = quoted.split(/\s+/);
  return argv.every((part) => /^[A-Za-z0-9._:/=@+-]+$/.test(part)) ? argv : undefined;
}

/** Env keys an agent may not set through a shim or terminal sign-in without the user editing it themselves. */
const UNSAFE_ENV = /^(PATH|LD_.*|DYLD_.*|NODE_OPTIONS|PYTHONPATH|BASH_ENV|HTTPS?_PROXY|SSL_CERT_FILE)$/i;

export function safeAgentEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !UNSAFE_ENV.test(key) && typeof value === "string") out[key] = value;
  }
  return out;
}

import { isHarnessId, type HarnessId } from "./harness.js";

/*
 * What a person changed about one agent. Every field is optional, and an
 * absent field means the preset's own behaviour. Binary path, arguments and
 * environment apply where Capsule starts the agent itself (direct mode); the
 * Gateway starts agents on its own host from its own configuration.
 */
export interface AgentOverride {
  /** False hides the agent everywhere except Agents, where it can be turned back on. */
  enabled?: boolean;
  /** The program to launch instead of the one found on PATH. */
  binaryPath?: string;
  /** Appended to the preset's own launch arguments. */
  args?: string[];
  /** Added to the agent's environment, such as a config folder for a second account. */
  env?: Record<string, string>;
}

export type AgentOverrides = Partial<Record<HarnessId, AgentOverride>>;

const MAX_ARGS = 64;
const MAX_ENV = 64;
const MAX_TEXT = 4096;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeOverride(value: unknown): AgentOverride | undefined {
  const input = record(value);
  if (!input) return undefined;
  const out: AgentOverride = {};
  if (input.enabled === false) out.enabled = false;
  const binaryPath = typeof input.binaryPath === "string" ? input.binaryPath.trim() : "";
  if (binaryPath && binaryPath.length <= 1024) out.binaryPath = binaryPath;
  if (Array.isArray(input.args)) {
    const args = input.args.filter((arg): arg is string => typeof arg === "string" && arg.length > 0 && arg.length <= MAX_TEXT).slice(0, MAX_ARGS);
    if (args.length) out.args = args;
  }
  const env = Object.entries(record(input.env) ?? {})
    .filter((entry): entry is [string, string] => ENV_NAME.test(entry[0]) && typeof entry[1] === "string" && entry[1].length <= MAX_TEXT)
    .slice(0, MAX_ENV);
  if (env.length) out.env = Object.fromEntries(env);
  return Object.keys(out).length ? out : undefined;
}

/** Known agents only, each with only the fields it actually sets. A corrupt file loses the bad parts, not the rest. */
export function normalizeAgentOverrides(value: unknown): AgentOverrides | undefined {
  const entries = Object.entries(record(value) ?? {}).flatMap(([id, item]) => {
    const override = isHarnessId(id) ? normalizeOverride(item) : undefined;
    return override ? [[id, override] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function agentEnabled(overrides: AgentOverrides | undefined, harnessId: string): boolean {
  return !isHarnessId(harnessId) || overrides?.[harnessId]?.enabled !== false;
}

/** `KEY=value` per line into a map. Lines that are not an assignment come back so the form can say which. */
export function parseEnvLines(text: string): { env: Record<string, string>; invalid: string[] } {
  const env: Record<string, string> = {};
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    const name = at > 0 ? line.slice(0, at).trim() : "";
    if (!ENV_NAME.test(name)) invalid.push(line);
    else env[name] = line.slice(at + 1).trim();
  }
  return { env, invalid };
}

export function formatEnvLines(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([name, value]) => `${name}=${value}`).join("\n");
}

/** One agent's override with `patch` applied; fields set to undefined or empty are dropped. */
export function patchAgentOverrides(overrides: AgentOverrides | undefined, harnessId: HarnessId, patch: AgentOverride): AgentOverrides {
  const next: AgentOverrides = { ...overrides };
  const merged = normalizeOverride({ ...overrides?.[harnessId], ...patch });
  if (merged) next[harnessId] = merged;
  else delete next[harnessId];
  return next;
}

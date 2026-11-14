import type { McpServerConfig, Provenance } from "./config.js";
import { PRESET_HARNESSES } from "./harness.js";
import { folderMatchesGlob } from "./permission-rules.js";

export type McpTransport = "stdio" | "http";

/** Whether a configured server reaches the next conversation, and if not, why. */
export type McpServerStatus =
  | { state: "offered" }
  | { state: "off"; reason: "disabled" | "project" | "profile" | "name"; detail: string }
  | { state: "needs-env"; missing: string[] };

/** One configured server as the Tools (MCP) settings show it. */
export interface McpServerView {
  name: string;
  transport: McpTransport;
  /** The command line or URL as written, `${env:…}` unexpanded. */
  detail: string;
  source: Provenance;
  /** The file that turned it on or off here, when it is not the one that defined it. */
  override?: Provenance;
  enabled: boolean;
  projects?: string[];
  status: McpServerStatus;
}

/** Names travel into agent configuration keys, so they stay plain. */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** An entry that only turns a server on or off, written in a project file over a server defined elsewhere. */
export function isMcpServerPatch(config: Partial<McpServerConfig>): boolean {
  return !("command" in config) && !("url" in config);
}

export function mcpTransport(config: McpServerConfig): McpTransport {
  return "url" in config ? "http" : "stdio";
}

export function describeMcpServer(config: McpServerConfig): string {
  return "url" in config ? config.url : [config.command, ...(config.args ?? [])].join(" ");
}

const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** `${env:NAME}` replaced from Capsule's environment, so a token need not sit in the file. */
export function expandEnvRefs(value: string, env: Readonly<Record<string, string | undefined>>): { value: string; missing: string[] } {
  const missing: string[] = [];
  const expanded = value.replace(ENV_REF, (_, name: string) => {
    const found = env[name];
    if (found === undefined || found === "") missing.push(name);
    return found ?? "";
  });
  return { value: expanded, missing };
}

/** The server with `env` and `headers` values expanded, and the variables that were not set. */
export function expandMcpSecrets(config: McpServerConfig, env: Readonly<Record<string, string | undefined>>): { config: McpServerConfig; missing: string[] } {
  const missing = new Set<string>();
  const expandMap = (map?: Record<string, string>) => map && Object.fromEntries(Object.entries(map).map(([key, raw]) => {
    const { value, missing: absent } = expandEnvRefs(raw, env);
    for (const name of absent) missing.add(name);
    return [key, value];
  }));
  const next: McpServerConfig = "url" in config
    ? { ...config, ...(config.headers ? { headers: expandMap(config.headers) } : {}) }
    : { ...config, ...(config.env ? { env: expandMap(config.env) } : {}) };
  return { config: next, missing: [...missing] };
}

export function mcpServerStatus(name: string, config: McpServerConfig, context: {
  root?: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** The starting profile's `mcp` list, when it has one. */
  profileMcp?: readonly string[];
}): McpServerStatus {
  if (!MCP_SERVER_NAME.test(name)) return { state: "off", reason: "name", detail: "Use letters, digits, - and _ in a server's name." };
  if (config.enabled === false) return { state: "off", reason: "disabled", detail: "Turned off." };
  if (config.projects?.length) {
    const { root } = context;
    if (!root || !config.projects.some((glob) => folderMatchesGlob(root, glob, context.home))) {
      return { state: "off", reason: "project", detail: `Only in ${config.projects.join(", ")}.` };
    }
  }
  if (context.profileMcp && !context.profileMcp.includes(name)) return { state: "off", reason: "profile", detail: "Not in this profile's mcp list." };
  const missing = expandMcpSecrets(config, context.env).missing;
  return missing.length ? { state: "needs-env", missing } : { state: "offered" };
}

/** How one transport reaches an agent: always, when the agent says it takes it, or not at all. */
export type McpCarry = "carried" | "if-reported" | "not-carried";

export interface McpDelivery {
  stdio: McpCarry;
  http: McpCarry;
  note: string;
}

/**
 * Where Capsule's configured servers reach, per harness and route. The
 * Gateway owns its own tools; a native session takes what its own session
 * API accepts; an ACP agent always takes stdio servers and takes HTTP ones
 * when it reports `mcpCapabilities.http`.
 */
export function mcpDelivery(harnessId: string, route: "direct" | "gateway"): McpDelivery {
  if (route === "gateway") {
    return { stdio: "not-carried", http: "not-carried", note: "Gateway threads use the tools configured on the Gateway, in its own plugin settings." };
  }
  const preset = PRESET_HARNESSES.find((item) => item.id === harnessId);
  switch (preset?.nativeCommand?.protocol) {
    case "claude": return { stdio: "carried", http: "carried", note: "Added to the session alongside the agent's own servers." };
    case "codex": return { stdio: "carried", http: "carried", note: "Added to the thread as configuration overrides, alongside the agent's own servers." };
    case "msp": return { stdio: "not-carried", http: "not-carried", note: "This agent's session protocol has no way to add servers yet." };
  }
  if (preset?.directCommand || preset?.acpxCommand) {
    return { stdio: "carried", http: "if-reported", note: "Every ACP agent takes local servers. HTTP servers reach agents that report HTTP support." };
  }
  return { stdio: "not-carried", http: "not-carried", note: "This agent does not run in direct mode." };
}

export interface McpTestInput { name: string; projectId?: string }

/** `everywhere` writes your user file; `project` writes the project's local file. */
export interface McpEnabledInput { name: string; enabled: boolean; where: "everywhere" | "project"; projectId?: string }

/** What the Test button reports: the server's tools, or why it could not list them. */
export type McpTestResult =
  | { ok: true; tools: string[]; durationMs: number }
  | { ok: false; error: string; durationMs: number; stderr?: string };

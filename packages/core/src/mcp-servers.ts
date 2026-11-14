import type { AcpMcpServer } from "@capsule/acp";
import {
  describeMcpServer,
  expandMcpSecrets,
  mcpServerStatus,
  mcpTransport,
  type EffectiveExtendedConfig,
  type McpServerView,
} from "@capsule/shared";

export interface McpContext {
  /** The project folder, which `projects` globs match. */
  root?: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  profileMcp?: readonly string[];
}

type Servers = EffectiveExtendedConfig["mcpServers"];

/** Every configured server with whether the next conversation here gets it. */
export function mcpServerViews(servers: Servers, context: McpContext): McpServerView[] {
  return Object.entries(servers).map(([name, entry]) => ({
    name,
    transport: mcpTransport(entry.value),
    detail: describeMcpServer(entry.value),
    source: entry.source,
    ...(entry.override ? { override: entry.override } : {}),
    enabled: entry.value.enabled !== false,
    ...(entry.value.projects?.length ? { projects: entry.value.projects } : {}),
    status: mcpServerStatus(name, entry.value, context),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The servers to offer one spawn, secrets expanded, in the ACP shape every direct transport reads. */
export function offeredMcpServers(servers: Servers, context: McpContext): AcpMcpServer[] {
  return Object.entries(servers).flatMap(([name, entry]): AcpMcpServer[] => {
    if (mcpServerStatus(name, entry.value, context).state !== "offered") return [];
    const config = expandMcpSecrets(entry.value, context.env).config;
    const pairs = (map?: Record<string, string>) => Object.entries(map ?? {}).map(([key, value]) => ({ name: key, value }));
    return "url" in config
      ? [{ type: "http", name, url: config.url, headers: pairs(config.headers) }]
      : [{ name, command: config.command, args: config.args ?? [], env: pairs(config.env), ...(config.cwd ? { cwd: config.cwd } : {}) }];
  });
}

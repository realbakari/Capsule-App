import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AcpMcpServer } from "@capsule/acp";

/** Offered servers in the SDK's shape. They join the agent's own servers; `cwd` has no place here. */
export function claudeMcpServers(servers: readonly AcpMcpServer[]): Record<string, McpServerConfig> {
  return Object.fromEntries(servers.map((server): [string, McpServerConfig] => "command" in server
    ? [server.name, { type: "stdio", command: server.command, args: server.args, env: Object.fromEntries(server.env.map((item) => [item.name, item.value])) }]
    : [server.name, { type: "http", url: server.url, headers: Object.fromEntries((server.headers ?? []).map((item) => [item.name, item.value])) }]));
}

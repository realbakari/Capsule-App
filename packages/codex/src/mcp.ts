import type { AcpMcpServer } from "@capsule/acp";

/*
 * Offered servers as thread configuration overrides. One dotted key per
 * server sets that server alone, so the person's own `mcp_servers` table in
 * their Codex configuration is kept rather than replaced.
 */
export function codexMcpConfig(servers: readonly AcpMcpServer[]): Record<string, unknown> {
  return Object.fromEntries(servers.map((server) => [`mcp_servers.${server.name}`, "command" in server
    ? { command: server.command, args: server.args, env: Object.fromEntries(server.env.map((item) => [item.name, item.value])), ...(server.cwd ? { cwd: server.cwd } : {}) }
    : { url: server.url, http_headers: Object.fromEntries((server.headers ?? []).map((item) => [item.name, item.value])) }]));
}

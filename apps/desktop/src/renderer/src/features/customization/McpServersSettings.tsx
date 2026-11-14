import { useState } from "react";
import { mcpDelivery, PRESET_HARNESSES, type McpCarry, type McpServerView, type McpTestResult } from "@capsule/shared";
import { settingsFileTarget, shortConfigPath, sourceChip } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { Switch } from "../settings/controls";
import { mcpStatusText, testDuration } from "./profile-view";
import "../conversation/commands.css";
import "./profiles.css";

const DESKTOP_ONLY = "Change this on the desktop.";

const CARRY: Record<McpCarry, string> = { carried: "Yes", "if-reported": "If the agent reports it", "not-carried": "No" };

const EXAMPLE = `"mcpServers": {
  "docs": {
    "command": "npx",
    "args": ["-y", "docs-mcp-server"],
    "env": { "DOCS_TOKEN": "\${env:DOCS_TOKEN}" }
  },
  "tracker": {
    "url": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "Bearer \${env:TRACKER_TOKEN}" }
  }
}`;

/** Settings → Tools (MCP): servers configured once and offered to every direct conversation. */
export function McpServersSettings() {
  const { api, project, projectId, config, configDiagnostics, harnesses } = useWorkspace();
  const [tests, setTests] = useState<Record<string, McpTestResult | "running">>({});
  const [failure, setFailure] = useState<string>();
  const desktop = api.isDesktop === true;
  const servers = config?.mcpServers ?? [];
  const here = project?.workingDirectory ? project : undefined;
  const pending = (configDiagnostics?.trust?.pending ?? []).filter((item) => item.kind === "mcp-server");
  const home = api.homeDir || undefined;
  const run = (work: () => Promise<unknown>) => {
    setFailure(undefined);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught)));
  };
  const test = (name: string) => {
    setTests((current) => ({ ...current, [name]: "running" }));
    void api.mcpTest({ name, ...(projectId ? { projectId } : {}) })
      .then((result) => setTests((current) => ({ ...current, [name]: result })))
      .catch((caught: unknown) => setTests((current) => ({ ...current, [name]: { ok: false, error: formatUserError(caught), durationMs: 0 } })));
  };
  const toggle = (server: McpServerView, enabled: boolean, where: "everywhere" | "project") =>
    run(() => api.mcpSetEnabled({ name: server.name, enabled, where, ...(where === "project" && projectId ? { projectId } : {}) }));
  const reach = (harnesses.length ? harnesses : PRESET_HARNESSES).filter((harness) => PRESET_HARNESSES.some((preset) => preset.id === harness.id));

  return (
    <div className="card commands-card mcp-card">
      <h3>MCP servers</h3>
      <p className="muted">
        Add a server once and every agent Capsule starts directly gets it, in every project or only the ones you list.
        Gateway threads use the tools configured on the Gateway, in its own plugin settings.
      </p>
      <div className="commands-card-actions">
        <button type="button" className="ghost" disabled={!desktop} onClick={() => run(() => api.configOpenFile(settingsFileTarget("user")))}>Open settings.json</button>
        {here && <button type="button" className="ghost" disabled={!desktop} onClick={() => run(() => api.configOpenFile(settingsFileTarget("project", projectId)))}>Open {here.name} settings</button>}
      </div>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      {servers.length === 0 && (
        <div className="commands-card-empty">
          <p>No servers yet. Add them under <code>mcpServers</code> in your settings file. <code>{"${env:NAME}"}</code> reads a token from Capsule's environment, so it never sits in the file:</p>
          <pre>{EXAMPLE}</pre>
        </div>
      )}
      {servers.length > 0 && (
        <ul className="commands-card-list" aria-label="MCP servers">
          {servers.map((server) => {
            const chip = sourceChip(server.source);
            const result = tests[server.name];
            const userServer = server.source.scope === "user";
            return (
              <li key={server.name} data-mcp-server={server.name}>
                <div className="mcp-row-head">
                  <code>{server.name}</code>
                  <span className="suggest-badge">{server.transport === "stdio" ? "Local command" : "HTTP"}</span>
                  {chip && <span className="setting-source-chip" data-layer={chip.layer} title={chip.path}>{chip.label}</span>}
                  <span className="mcp-row-controls">
                    {here ? (
                      <label>In {here.name}<Switch label={`${server.name} in ${here.name}`} checked={server.enabled} disabled={!desktop} title={desktop ? undefined : DESKTOP_ONLY} onChange={(on) => toggle(server, on, "project")} /></label>
                    ) : (
                      <label>On<Switch label={`${server.name} on`} checked={server.enabled} disabled={!desktop || !userServer} title={!desktop ? DESKTOP_ONLY : userServer ? undefined : "Set in the project's file. Open a project to switch it there."} onChange={(on) => toggle(server, on, "everywhere")} /></label>
                    )}
                    <button type="button" className="chip" disabled={!desktop || result === "running"} title={desktop ? "Start the server and list its tools" : "Available in the desktop app."}
                      onClick={() => test(server.name)}>{result === "running" ? "Testing…" : "Test"}</button>
                  </span>
                </div>
                <p className="mcp-detail" title={server.detail}>{server.detail}</p>
                <p className="mcp-status" data-state={server.status.state}>
                  {mcpStatusText(server.status)}
                  {server.override && <> · switched in <span title={server.override.path}>{shortConfigPath(server.override.path ?? "", home)}</span></>}
                  {here && userServer && !server.override && (
                    <> · <button type="button" className="mcp-link" disabled={!desktop} onClick={() => toggle(server, !server.enabled, "everywhere")}>{server.enabled ? "Turn off everywhere" : "Turn on everywhere"}</button></>
                  )}
                </p>
                {result && result !== "running" && (
                  <div className="mcp-test" data-ok={result.ok} role="status">
                    {result.ok
                      ? `${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"} in ${testDuration(result.durationMs)}${result.tools.length ? `: ${result.tools.slice(0, 12).join(", ")}${result.tools.length > 12 ? "…" : ""}` : ""}`
                      : result.error}
                    {!result.ok && result.stderr && <details><summary>What it printed</summary><pre>{result.stderr}</pre></details>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pending.length > 0 && (
        <details className="advanced commands-card-problems" open>
          <summary>{pending.length} {pending.length === 1 ? "server waits" : "servers wait"} until you trust {here?.name ?? "this project"}</summary>
          <ul>{pending.map((item, index) => <li key={`${item.path}-${index}`}><span>{item.detail}</span></li>)}</ul>
        </details>
      )}
      <details className="advanced">
        <summary>Where these servers reach</summary>
        <table className="mcp-reach">
          <thead><tr><th>Agent</th><th>Local command</th><th>HTTP</th><th>Gateway threads</th></tr></thead>
          <tbody>
            {reach.map((harness) => {
              const direct = mcpDelivery(harness.id, "direct");
              return <tr key={harness.id} title={direct.note}><td>{harness.name}</td><td>{CARRY[direct.stdio]}</td><td>{CARRY[direct.http]}</td><td>No</td></tr>;
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}

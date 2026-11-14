import { useState } from "react";
import type { ConfigSourceReport, CustomizationRunRecord, SourceState } from "@capsule/shared";
import { PENDING_KIND_LABELS, asSentence, shortConfigPath, sourceFileTarget, sourcesByPrecedence } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { RefreshIcon } from "../shell/icons";
import { HooksList } from "./HooksList";

const SOURCE_LABELS: Record<string, string> = {
  "settings:local": "Project, only you",
  "settings:project": "Project",
  "settings:legacy": "capsule.json",
  "settings:user": "User settings",
  "keybindings:user": "Key bindings",
};

const STATE_LABELS: Record<SourceState, string> = {
  ok: "Loaded",
  missing: "Not created",
  broken: "Broken",
  untrusted: "Waiting for trust",
  skipped: "Skipped",
};

const RUN_KINDS: Record<CustomizationRunRecord["kind"], string> = {
  hook: "Hook",
  "status-line": "Status line",
  "command-shell": "Command",
  automation: "Automation",
};

/**
 * Settings → Diagnostics → Customization: every file Capsule read, what went
 * wrong in each, what waits for trust, and what ran. Read-only on a paired
 * device; every button here changes the host.
 */
export function CustomizationDoctor() {
  const { api, config, configDiagnostics: diagnostics } = useWorkspace();
  const [error, setError] = useState<string>();
  const canWrite = api.isDesktop === true;
  const projectId = config?.project?.projectId;
  const home = window.capsule?.homeDir;

  function run(action: () => Promise<unknown>) {
    setError(undefined);
    void action().catch((caught: unknown) => setError(formatUserError(caught)));
  }

  function openSource(source: Pick<ConfigSourceReport, "kind" | "scope" | "path">) {
    const target = sourceFileTarget(source, projectId);
    run(async () => target ? api.configOpenFile(target) : api.openPath(source.path));
  }

  if (!diagnostics) {
    return (
      <div className="card customization-doctor">
        <h3>Customization</h3>
        <p className="muted">Reading settings files…</p>
      </div>
    );
  }

  const sources = sourcesByPrecedence(diagnostics.sources);
  const { problems, trust, runs } = diagnostics;
  const known = (path: string) => diagnostics.sources.find((source) => source.path === path);

  return (
    <div className="card customization-doctor" id="customization-doctor">
      <div className="doctor-head">
        <h3>Customization</h3>
        <span className={`doctor-summary${problems.length ? " has-problems" : ""}`}>
          {problems.length === 0 ? "No problems" : `${problems.length} ${problems.length === 1 ? "problem" : "problems"}`}
        </span>
        {canWrite && !diagnostics.safeMode && (
          <button type="button" className="ghost" title="Read every settings file again now" onClick={() => run(() => api.configReload(projectId))}>
            <RefreshIcon size={13} />
            Reload
          </button>
        )}
      </div>
      <p className="muted">
        The files that customize Capsule, strongest first. A file that stops parsing keeps its last good copy.
      </p>

      <div className={`doctor-safe-mode${diagnostics.safeMode ? " is-on" : ""}`}>
        <span>
          {diagnostics.safeMode
            ? "Safe mode is on. No settings file, command, hook, theme, key binding or MCP server is loaded."
            : "Safe mode is off."}
        </span>
        {canWrite && (
          <button type="button" className="ghost" onClick={() => run(() => api.appRestart({ safeMode: !diagnostics.safeMode }))}>
            {diagnostics.safeMode ? "Restart normally" : "Restart without customizations"}
          </button>
        )}
      </div>

      <h4 className="doctor-heading">Files</h4>
      <ul className="doctor-list">
        {sources.map((source) => (
          <li key={`${source.kind}:${source.path}`} className="doctor-source">
            <div className="doctor-row">
              <span className="doctor-scope">{SOURCE_LABELS[`${source.kind}:${source.scope}`] ?? source.kind}</span>
              <span className={`doctor-state is-${source.state}`}>{STATE_LABELS[source.state]}</span>
              <span className="doctor-path" title={source.path}>{shortConfigPath(source.path, home)}</span>
              {canWrite && source.state !== "skipped" && (
                <button type="button" className="ghost doctor-open" onClick={() => openSource(source)}>
                  {source.state === "missing" ? "Create" : "Open"}
                </button>
              )}
            </div>
            {source.keys && source.keys.length > 0 && <div className="doctor-keys">Sets {source.keys.join(", ")}</div>}
            {source.error && (
              <div className="doctor-error">
                Line {source.error.line}, column {source.error.column}: {asSentence(source.error.message)}{" "}
                {source.usingLastGood ? "Using last good copy." : "Not applied until it parses."}
              </div>
            )}
          </li>
        ))}
      </ul>

      <h4 className="doctor-heading">Problems</h4>
      {problems.length === 0 ? (
        <p className="doctor-empty">No problems. Every file parsed and every entry applied.</p>
      ) : (
        <ul className="doctor-list">
          {problems.map((problem, index) => {
            const source = known(problem.path);
            return (
              <li key={`${problem.path}:${problem.key ?? ""}:${index}`} className="doctor-problem">
                <span className={`doctor-severity is-${problem.severity}`}>{problem.severity === "error" ? "Error" : "Warning"}</span>
                <span className="doctor-problem-copy">
                  {problem.key && !problem.message.includes(problem.key) && <><code>{problem.key}</code>{" "}</>}{problem.message}
                  <span className="doctor-problem-file">
                    {canWrite ? (
                      <button type="button" className="doctor-link" title={problem.path} onClick={() => openSource(source ?? { kind: "settings", scope: "default", path: problem.path })}>
                        {shortConfigPath(problem.path, home)}
                      </button>
                    ) : shortConfigPath(problem.path, home)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {trust && projectId && (
        <>
          <h4 className="doctor-heading">Trust</h4>
          {trust.trusted ? (
            <div className="doctor-trust">
              <span>
                This project is trusted{trust.trustedAt ? ` since ${new Date(trust.trustedAt).toLocaleDateString()}` : ""}. Its hooks, MCP servers, automations and allow rules apply.
              </span>
              {canWrite && <button type="button" className="ghost" onClick={() => run(() => api.configTrust(projectId, false))}>Revoke trust</button>}
            </div>
          ) : trust.pending.length === 0 ? (
            <p className="doctor-empty">Nothing in this project's files waits for trust.</p>
          ) : (
            <div className="doctor-trust is-pending">
              <span>This project's files want to run {trust.pending.length === 1 ? "one thing" : `${trust.pending.length} things`}. Nothing runs until you trust the folder.</span>
              <ul className="trust-items">
                {trust.pending.map((item, index) => (
                  <li key={`${item.kind}:${item.detail}:${index}`}>
                    <span className="trust-kind">{PENDING_KIND_LABELS[item.kind]}</span>
                    <code className="trust-detail">{item.detail}</code>
                    <span className="trust-file" title={item.path}>{shortConfigPath(item.path, home)}</span>
                  </li>
                ))}
              </ul>
              {canWrite && <button type="button" className="chip" onClick={() => run(() => api.configTrust(projectId, true))}>Trust this project</button>}
            </div>
          )}
        </>
      )}

      <HooksList diagnostics={diagnostics} home={home} />

      <h4 className="doctor-heading">Recent runs</h4>
      {runs.length === 0 ? (
        <p className="doctor-empty">No hook, status line or command has run yet.</p>
      ) : (
        <ul className="doctor-list">
          {[...runs].reverse().map((record) => (
            <li key={record.id}>
              <details className="doctor-run">
                <summary>
                  <span className="doctor-run-time">{new Date(record.startedAt).toLocaleTimeString()}</span>
                  <span className="doctor-scope">{RUN_KINDS[record.kind]}</span>
                  <span className="doctor-run-label">{record.label}</span>
                  <span className={`doctor-exit${record.exitCode === 0 ? "" : " is-failed"}`}>
                    {record.exitCode === null ? "no exit code" : `exit ${record.exitCode}`}
                  </span>
                </summary>
                <div className="doctor-run-body">
                  <code>{record.command}</code>
                  <span className="doctor-keys">{shortConfigPath(record.source, home)} · {record.durationMs} ms{record.outcome ? ` · ${record.outcome}` : ""}</span>
                  {record.stderr ? <pre>{record.stderr}</pre> : <span className="doctor-keys">Nothing on stderr.</span>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="notice" role="alert">{error}</div>}
    </div>
  );
}

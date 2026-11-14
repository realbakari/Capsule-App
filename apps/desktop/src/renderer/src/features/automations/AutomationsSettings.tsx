import { useState } from "react";
import { AUTOMATION_TEMPLATES, type AutomationView } from "@capsule/shared";
import { settingsFileTarget, sourceChip } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { Switch } from "../settings/controls";
import "../conversation/commands.css";
import "./automations.css";

const DESKTOP_ONLY = "Change this on the desktop.";

const EXAMPLE = `"automations": [
  {
    "id": "triage-issues",
    "name": "Triage new issues",
    "schedule": "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
    "prompt": "Triage the issues opened since yesterday."
  }
]`;

export function automationWhen(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function lastRunText(view: AutomationView): string | undefined {
  const last = view.lastRun;
  if (!last) return undefined;
  const when = automationWhen(last.at);
  if (last.status === "running") return `Running since ${when}`;
  if (last.status === "completed") return `Last run ${when} · done`;
  return `Last run ${when} · failed${last.detail ? `: ${last.detail}` : ""}`;
}

/** Settings → Automations: prompts and commands on a schedule, with what ran, what is next, and what was missed. */
export function AutomationsSettings() {
  const { api, project, projectId, config, configDiagnostics, sessions, setProjectId, setView } = useWorkspace();
  const [failure, setFailure] = useState<string>();
  const [template, setTemplate] = useState(AUTOMATION_TEMPLATES[0]!.id);
  const [busy, setBusy] = useState<string>();
  const desktop = api.isDesktop === true && !config?.safeMode;
  const automations = config?.automations ?? [];
  const here = project?.workingDirectory ? project : undefined;
  const pending = (configDiagnostics?.trust?.pending ?? []).filter((item) => item.kind === "automation");
  const scoped = projectId ? { projectId } : {};
  const run = (label: string, work: () => Promise<unknown>) => {
    setFailure(undefined);
    setBusy(label);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught))).finally(() => setBusy(undefined));
  };
  const openThread = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setProjectId(session.projectId, session.id);
    setView("chat");
  };

  return (
    <div className="card commands-card automations-card">
      <h3>Automations</h3>
      <p className="muted">
        A prompt or command Capsule sends on a schedule while it is open. Each run starts a new thread, marked unread until you open it.
        Yours go to the Inbox; a project's go to that project.
      </p>
      <div className="commands-card-actions">
        <select aria-label="Automation template" value={template} disabled={!desktop} onChange={(event) => setTemplate(event.target.value)}>
          {AUTOMATION_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? "Adds it paused to your settings file and opens the file" : DESKTOP_ONLY}
          onClick={() => run("create", () => api.automationsCreate({ template, scope: "user" }))}>Add to your settings</button>
        {here && <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? `Adds it paused to ${here.name}'s local settings, which only you use` : DESKTOP_ONLY}
          onClick={() => run("create", () => api.automationsCreate({ template, scope: "local", projectId }))}>Add to {here.name}</button>}
        <button type="button" className="ghost" disabled={api.isDesktop !== true} onClick={() => run("open", () => api.configOpenFile(settingsFileTarget("user")))}>Open settings.json</button>
      </div>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      {config?.safeMode && <p className="muted">Safe mode is on, so no automation runs.</p>}
      {automations.length === 0 && (
        <div className="commands-card-empty">
          <p>No automations yet. Add one from a template above, or write it under <code>automations</code> in a settings file:</p>
          <pre>{EXAMPLE}</pre>
        </div>
      )}
      {automations.length > 0 && (
        <ul className="commands-card-list" aria-label="Automations">
          {automations.map((view) => {
            const chip = sourceChip(view.source);
            const last = lastRunText(view);
            return (
              <li key={view.key} data-automation={view.key} data-enabled={view.enabled}>
                <div className="automation-row-head">
                  <strong>{view.name}</strong>
                  {chip && <span className="setting-source-chip" data-layer={chip.layer} title={chip.path}>{chip.label}</span>}
                  {view.command && <code>/{view.command.replace(/^\//, "")}</code>}
                  <span className="automation-row-controls">
                    <label>{view.enabled ? "On" : "Paused"}
                      <Switch label={`${view.name} on`} checked={view.enabled} disabled={!desktop || Boolean(busy)} title={desktop ? undefined : DESKTOP_ONLY}
                        onChange={(enabled) => run(view.key, () => api.automationsSetEnabled({ key: view.key, enabled, ...scoped }))} />
                    </label>
                    <button type="button" className="chip" disabled={!desktop || view.running || Boolean(view.problem) || Boolean(busy)}
                      title={!desktop ? DESKTOP_ONLY : view.running ? "Still running" : view.problem}
                      onClick={() => run(view.key, () => api.automationsRunNow({ key: view.key, ...scoped }))}>{busy === view.key ? "Starting…" : "Run now"}</button>
                  </span>
                </div>
                <p className="automation-schedule">
                  {view.problem ? <span className="automation-problem">{view.problem}</span> : view.scheduleText}
                  {view.nextRunAt && <> · next {automationWhen(view.nextRunAt)}</>}
                  {!view.projectId && <> · Inbox</>}
                </p>
                {view.prompt && <p className="commands-card-description automation-prompt" title={view.prompt}>{view.prompt}</p>}
                {(last || view.skippedAt) && (
                  <p className="automation-last" data-status={view.lastRun?.status}>
                    {last}
                    {view.lastRun?.sessionId && sessions.some((item) => item.id === view.lastRun!.sessionId) && (
                      <> · <button type="button" className="mcp-link" onClick={() => openThread(view.lastRun!.sessionId!)}>Open thread</button></>
                    )}
                    {view.skippedAt && <>{last ? " · " : ""}Skipped {automationWhen(view.skippedAt)}, the previous run was still going</>}
                  </p>
                )}
                {view.missed && (
                  <div className="automation-missed" role="status">
                    <span>Missed while closed: {view.missed.count}{view.missed.count === 1 ? ` (${automationWhen(view.missed.last)})` : `, last ${automationWhen(view.missed.last)}`}</span>
                    <button type="button" className="chip" disabled={!desktop || view.running || Boolean(busy)} title={desktop ? "Runs it once now" : DESKTOP_ONLY}
                      onClick={() => run(view.key, () => api.automationsRunNow({ key: view.key, ...scoped }))}>Run now</button>
                    <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? undefined : DESKTOP_ONLY}
                      onClick={() => run(view.key, () => api.automationsDismissMissed({ key: view.key, ...scoped }))}>Dismiss</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pending.length > 0 && (
        <details className="advanced commands-card-problems" open>
          <summary>{pending.length} {pending.length === 1 ? "automation waits" : "automations wait"} until you trust {here?.name ?? "this project"}</summary>
          <ul>{pending.map((item, index) => <li key={`${item.path}-${index}`}><span>{item.detail}</span></li>)}</ul>
        </details>
      )}
      <details className="advanced">
        <summary>How automations run</summary>
        <ul className="automation-rules">
          <li>Capsule has to be open. An occurrence that passes while it is closed, or while the computer sleeps, is counted as missed and waits here. It never runs on its own later.</li>
          <li>One run at a time. If a run is still going when the next one comes round, that one is skipped and noted.</li>
          <li>A run sends its prompt or command like a message you typed, so commands, hooks and the profile apply.</li>
          <li>A paired device sees this list. Pausing and running stay on the desktop.</li>
        </ul>
      </details>
    </div>
  );
}

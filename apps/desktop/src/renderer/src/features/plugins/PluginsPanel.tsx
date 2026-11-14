import { useCallback, useEffect, useState } from "react";
import type { PluginInspection, PluginOptionValue, PluginView } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { Switch } from "../settings/controls";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { PluginContentsList, PluginOptionsForm, PluginProblems, type OptionDraft } from "./PluginContents";
import { onPluginIntent, takePluginIntent, type PluginIntent } from "./plugin-intent";
import "../conversation/commands.css";
import "./plugins.css";

const DESKTOP_ONLY = "Change this on the desktop.";

const EXAMPLE = `{
  "name": "team-setup",
  "version": "1.0.0",
  "description": "Our commands, hooks and theme",
  "author": { "name": "Your team" }
}`;

/**
 * Plugins: install from a folder, a zip or a git address, see exactly what
 * each adds, turn it on or off, fill in its options, and remove it. Settings
 * and the library both show this.
 */
export function PluginsPanel() {
  const { api, config } = useWorkspace();
  const desktop = api.isDesktop === true && !config?.safeMode;
  const plugins = config?.plugins ?? [];
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [shown, setShown] = useState<{ inspection: PluginInspection; validate: boolean }>();

  const inspect = useCallback((intent: PluginIntent | "git") => {
    setFailure(undefined);
    setBusy(intent);
    const from = intent === "validate" ? "folder" : intent;
    void api.pluginsInspect(from === "git" ? { from, url } : { from })
      .then((inspection) => { if (inspection) setShown({ inspection, validate: intent === "validate" }); })
      .catch((caught: unknown) => setFailure(formatUserError(caught)))
      .finally(() => setBusy(undefined));
  }, [api, url]);

  useEffect(() => {
    const take = () => {
      const intent = takePluginIntent();
      if (intent && desktop) inspect(intent);
    };
    take();
    return onPluginIntent(take);
  }, [desktop, inspect]);

  return (
    <div className="card commands-card plugins-card">
      <h3>Plugins</h3>
      <p className="muted">
        A plugin brings a whole setup in one folder: commands, profiles, styles, themes, skills, hooks, MCP servers and a status line.
        Before anything installs you see exactly what it adds, and nothing in it runs until you have seen that list and installed it.
      </p>
      <div className="commands-card-actions">
        <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? undefined : DESKTOP_ONLY} onClick={() => inspect("folder")}>{busy === "folder" ? "Reading…" : "Install from folder…"}</button>
        <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? undefined : DESKTOP_ONLY} onClick={() => inspect("zip")}>{busy === "zip" ? "Opening…" : "Install from zip…"}</button>
        <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? "Reads a folder in place and reloads it when you save" : DESKTOP_ONLY} onClick={() => inspect("dev")}>Load folder for development…</button>
        <button type="button" className="ghost" disabled={!desktop || Boolean(busy)} title={desktop ? "Runs the checks and lists what a folder adds, without installing it" : DESKTOP_ONLY} onClick={() => inspect("validate")}>Validate plugin folder…</button>
      </div>
      <form className="plugins-git" onSubmit={(event) => { event.preventDefault(); if (url.trim()) inspect("git"); }}>
        <input type="text" aria-label="Git repository address" placeholder="https://github.com/team/capsule-setup.git" value={url} spellCheck={false} disabled={!desktop || Boolean(busy)} onChange={(event) => setUrl(event.target.value)} />
        <button type="submit" className="ghost" disabled={!desktop || Boolean(busy) || !url.trim()} title={desktop ? undefined : DESKTOP_ONLY}>{busy === "git" ? "Cloning…" : "Inspect"}</button>
      </form>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      {config?.safeMode && <p className="muted">Safe mode is on, so no plugin loads.</p>}
      {plugins.length === 0 && !config?.safeMode && (
        <div className="commands-card-empty">
          <p>No plugins yet. A plugin is a folder with <code>capsule-plugin.json</code> at the top:</p>
          <pre>{EXAMPLE}</pre>
        </div>
      )}
      {plugins.length > 0 && (
        <ul className="commands-card-list plugins-list" aria-label="Installed plugins">
          {plugins.map((plugin) => <PluginRow key={plugin.name} plugin={plugin} desktop={desktop} />)}
        </ul>
      )}
      {shown && <PluginInstallDialog inspection={shown.inspection} validate={shown.validate} onClose={() => setShown(undefined)} />}
    </div>
  );
}

function PluginRow({ plugin, desktop }: { plugin: PluginView; desktop: boolean }) {
  const { api, setConfirm } = useWorkspace();
  const [draft, setDraft] = useState<OptionDraft>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const run = (work: () => Promise<unknown>) => {
    setFailure(undefined);
    setBusy(true);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught))).finally(() => setBusy(false));
  };
  const broken = plugin.problems.some((problem) => problem.severity === "error");
  const dirty = Object.keys(draft).length > 0;
  const save = () => run(async () => {
    const values: Record<string, PluginOptionValue | null> = {};
    for (const [key, value] of Object.entries(draft)) values[key] = value === undefined || value === "" ? null : value;
    await api.pluginsConfigure({ name: plugin.name, values });
    setDraft({});
  });
  const remove = () => setConfirm({
    title: plugin.dev ? `Remove ${plugin.name}?` : `Uninstall ${plugin.name}?`,
    detail: plugin.dev
      ? `Capsule stops loading ${plugin.root}. The folder itself is left as it is. Saved options and secrets for this plugin are removed.`
      : "Its folder, saved options and secrets are removed. Install it again to get it back.",
    confirmLabel: plugin.dev ? "Remove" : "Uninstall",
    danger: true,
    onConfirm: () => run(() => api.pluginsUninstall(plugin.name)),
  });

  return (
    <li data-plugin={plugin.name} data-enabled={plugin.enabled}>
      <div className="plugin-row-head">
        <strong>{plugin.name}</strong>
        {plugin.version && <span className="faint">{plugin.version}</span>}
        {plugin.dev && <span className="plugin-tag" data-dev title={plugin.root}>dev</span>}
        {plugin.author && <span className="faint plugin-author">by {plugin.author}</span>}
        <span className="plugin-row-controls">
          <label>{plugin.enabled ? "On" : "Off"}
            <Switch label={`${plugin.name} on`} checked={plugin.enabled} disabled={!desktop || busy || broken} title={desktop ? (broken ? "Fix the errors below first" : undefined) : DESKTOP_ONLY}
              onChange={(enabled) => run(() => api.pluginsSetEnabled({ name: plugin.name, enabled }))} />
          </label>
        </span>
      </div>
      {plugin.description && <p className="commands-card-description">{plugin.description}</p>}
      {plugin.missing.length > 0 && <p className="plugin-missing">Needs {plugin.missing.join(", ")} before it can be turned on.</p>}
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      <details className="advanced plugin-details">
        <summary>What it adds{plugin.problems.length ? ` · ${plugin.problems.length} ${plugin.problems.length === 1 ? "problem" : "problems"}` : ""}</summary>
        <PluginProblems problems={plugin.problems} />
        <PluginContentsList contents={plugin.contents} />
        {plugin.userConfig.length > 0 && (
          <div className="plugin-install-options">
            <h4>Options</h4>
            <PluginOptionsForm options={plugin.userConfig} draft={draft} current disabled={!desktop || busy} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} />
            <div className="commands-card-actions">
              <button type="button" className="ghost" disabled={!desktop || busy || !dirty} onClick={save}>Save options</button>
              {dirty && <button type="button" className="ghost" disabled={busy} onClick={() => setDraft({})}>Discard</button>}
            </div>
          </div>
        )}
        {plugin.contents.hooks.some((hook) => hook.event === "PermissionRequest") && (
          <div className="plugin-option plugin-option-inline plugin-approve">
            <div>
              <label htmlFor={`approve-${plugin.name}`}>Let this plugin approve requests</label>
              <p className="plugin-option-hint">Off: its permission hooks may deny or ask, and an allow is shown to you as a question. On: an allow approves the request without asking.</p>
            </div>
            <Switch label="Let this plugin approve requests" checked={plugin.mayApprove} disabled={!desktop || busy} title={desktop ? undefined : DESKTOP_ONLY}
              onChange={(mayApprove) => run(() => api.pluginsConfigure({ name: plugin.name, mayApprove }))} />
          </div>
        )}
        <div className="commands-card-actions">
          <button type="button" className="ghost" disabled={api.isDesktop !== true} onClick={() => void api.openPath(plugin.root)}>Open folder</button>
          <button type="button" className="ghost plugin-uninstall" disabled={!desktop || busy} title={desktop ? undefined : DESKTOP_ONLY} onClick={remove}>{plugin.dev ? "Remove" : "Uninstall"}</button>
        </div>
      </details>
    </li>
  );
}

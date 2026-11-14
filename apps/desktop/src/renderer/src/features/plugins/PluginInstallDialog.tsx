import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PLUGIN_RIGHTS_NOTICE, pluginInstallVerb, pluginRunsCode, type PluginInspection } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { AlertTriangleIcon, XIcon } from "../shell/icons";
import { draftValues, PluginContentsList, PluginOptionsForm, PluginProblems, type OptionDraft } from "./PluginContents";

const SOURCE_LABELS: Record<PluginInspection["source"]["kind"], string> = {
  folder: "Folder",
  zip: "Zip",
  git: "Repository",
  dev: "Development folder",
};

/**
 * The install confirmation screen, which is also the Validate result: every
 * command, hook, server, theme, profile and style the plugin adds, before
 * anything in it can run.
 */
export function PluginInstallDialog({ inspection, validate, onClose }: { inspection: PluginInspection; validate?: boolean; onClose: () => void }) {
  const { api } = useWorkspace();
  const card = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<OptionDraft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => {
    if (busy) return;
    if (inspection.token) void api.pluginsDiscard(inspection.token).catch(() => undefined);
    onClose();
  };
  useModalFocus(card, true, close);
  const manifest = inspection.manifest;
  const dev = inspection.source.kind === "dev";
  const errors = inspection.problems.filter((problem) => problem.severity === "error");
  const title = validate
    ? `Validate ${manifest ? `${manifest.name} ${manifest.version}` : "plugin folder"}`
    : manifest ? `${dev ? "Load" : "Install"} ${manifest.name} ${manifest.version}` : "This plugin cannot be installed";
  const install = () => {
    if (!inspection.token) return;
    setBusy(true);
    setError(undefined);
    void api.pluginsInstall({ token: inspection.token, values: draftValues(draft) })
      .then(onClose)
      .catch((caught: unknown) => setError(formatUserError(caught)))
      .finally(() => setBusy(false));
  };

  const modal = (
    <div className="palette-backdrop center" onClick={close}>
      <div className="dialog plugin-install-dialog" ref={card} role="dialog" aria-modal="true" aria-labelledby="plugin-install-title" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h3 id="plugin-install-title">{title}</h3>
            <p>
              {manifest && <>by {manifest.author.name} · </>}
              {SOURCE_LABELS[inspection.source.kind]} <code className="plugin-source" title={inspection.source.label}>{inspection.source.label}</code>
            </p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" disabled={busy} onClick={close}><XIcon size={14} /></button>
        </div>
        <div className="plugin-install-body">
          {manifest && <p className="plugin-description">{manifest.description}</p>}
          {inspection.installed && !validate && <p className="plugin-replaces">{pluginInstallVerb(inspection)}. Your settings and saved options for it are kept.</p>}
          {pluginRunsCode(inspection.contents) && (
            <p className="plugin-rights" role="note"><AlertTriangleIcon size={14} />{PLUGIN_RIGHTS_NOTICE} Nothing runs until the plugin is on.</p>
          )}
          <PluginProblems problems={inspection.problems} />
          {manifest && <PluginContentsList contents={inspection.contents} />}
          {!validate && inspection.token && inspection.userConfig.length > 0 && (
            <div className="plugin-install-options">
              <h4>Options</h4>
              <p className="muted">Secrets go to the Keychain. You can change these later in Settings → Plugins.</p>
              <PluginOptionsForm options={inspection.userConfig} draft={draft} disabled={busy} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} />
            </div>
          )}
          {error && <p className="commands-card-error" role="alert">{error}</p>}
        </div>
        <div className="actions plugin-install-footer">
          <button type="button" className="ghost" disabled={busy} onClick={close}>{validate || errors.length ? "Close" : "Cancel"}</button>
          {!validate && inspection.token && (
            <button type="button" className="send" disabled={busy} onClick={install}>
              {busy ? (dev ? "Loading…" : "Installing…") : dev ? "Load for development" : pluginInstallVerb(inspection)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}

import { useState } from "react";
import { PENDING_KIND_LABELS, pendingTrust, shortConfigPath } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { ShieldIcon } from "../shell/icons";

/* "Not now" holds for this run of Capsule, per project. */
const notNow = new Set<string>();

/**
 * A quiet note above an open thread when the project's settings files hold
 * things that run code and the folder is not trusted yet. It lists exactly
 * what would run; nothing does until someone says yes.
 */
export function TrustNotice() {
  const { api, config, configDiagnostics, sessionId } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [, dismissed] = useState(0);
  const project = config?.project;
  const pending = pendingTrust(config, configDiagnostics);
  if (!sessionId || !project || pending.length === 0 || notNow.has(project.projectId)) return null;
  const desktop = api.isDesktop === true;

  return (
    <div className="trust-notice" role="status">
      <div className="trust-notice-row">
        <ShieldIcon size={14} />
        <span className="trust-notice-copy">
          This project's settings want to run {pending.length === 1 ? "one thing" : `${pending.length} things`}. Nothing runs until you trust the folder
          {desktop ? "." : " on the host computer."}
        </span>
        <button type="button" className="ghost" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Hide list" : "What would run"}
        </button>
        {desktop && (
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(undefined);
              void api.configTrust(project.projectId, true)
                .catch((caught: unknown) => setError(formatUserError(caught)))
                .finally(() => setBusy(false));
            }}
          >
            Trust this project
          </button>
        )}
        <button type="button" className="ghost" onClick={() => { notNow.add(project.projectId); dismissed((value) => value + 1); }}>
          Not now
        </button>
      </div>
      {expanded && (
        <ul className="trust-items">
          {pending.map((item, index) => (
            <li key={`${item.kind}:${item.detail}:${index}`}>
              <span className="trust-kind">{PENDING_KIND_LABELS[item.kind]}</span>
              <code className="trust-detail">{item.detail}</code>
              <span className="trust-file" title={item.path}>{shortConfigPath(item.path, window.capsule?.homeDir)}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="trust-notice-error">{error}</p>}
    </div>
  );
}

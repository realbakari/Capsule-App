import { useCallback, useEffect, useState } from "react";
import { localTimings, type DiagnosticsSnapshot } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";

/*
 * What someone needs when something breaks: which build this is, whether the
 * optional Gateway is reachable, and Capsule's own recent log, in a form that
 * pastes into a bug report.
 */
export function Troubleshooting() {
  const { api } = useWorkspace();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const read = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.getDiagnostics();
      setSnapshot(next);
      return next;
    } catch (caught) {
      setError(`Could not read diagnostics: ${formatUserError(caught)}`);
      return undefined;
    }
  }, [api]);
  useEffect(() => { void read(); }, [read]);

  async function copy() {
    setCopied(false);
    const next = await read();
    if (!next) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...next, rendererPerformance: localTimings.snapshot() }, null, 2));
      setCopied(true);
    } catch {
      setError("Could not copy to the clipboard. Open Recent log below and copy it by hand.");
    }
  }

  const versions = snapshot && [`Capsule ${snapshot.capsuleVersion}`, snapshot.electronVersion && `Electron ${snapshot.electronVersion}`, snapshot.macosVersion && `macOS ${snapshot.macosVersion}`]
    .filter(Boolean).join(" · ");
  const log = snapshot?.connectionLogs ?? [];

  return (
    <div className="card troubleshooting">
      <h3>Troubleshooting</h3>
      {error && <p role="alert" className="settings-keybind-error">{error}</p>}
      {!snapshot && !error && <p role="status" className="muted">Reading diagnostics…</p>}
      {snapshot && <>
        <SettingRow label="Version" hint={versions}>{null}</SettingRow>
        <SettingRow
          label="Gateway"
          hint={snapshot.gatewayStatus === "connected" ? "Connected." : "Not connected. It is optional: agents on this computer run without it."}
        >{null}</SettingRow>
        <SettingRow
          label="Diagnostics"
          hint="Versions, connection state, timings and Capsule’s last 200 log lines, for a bug report. The log can name folders on this computer, so read it before you share it."
        >
          <div className="setting-inline settings-inline-tight">
            <button className="chip" type="button" onClick={() => void copy()}>Copy diagnostics</button>
            {copied && <span role="status" className="faint">Copied</span>}
          </div>
        </SettingRow>
        <details className="troubleshooting-log">
          <summary>Recent log{log.length ? ` · ${log.length} ${log.length === 1 ? "line" : "lines"}` : ""}</summary>
          {log.length
            ? <pre className="mono">{log.join("\n")}</pre>
            : <p className="faint">Nothing logged since Capsule started.</p>}
        </details>
      </>}
    </div>
  );
}

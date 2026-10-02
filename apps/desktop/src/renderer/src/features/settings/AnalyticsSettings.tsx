import { useEffect, useState } from "react";
import type { CapsuleSettings } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "./controls";

export function AnalyticsSettings({ settings, patch }: {
  settings: CapsuleSettings; patch: (input: Partial<CapsuleSettings>) => Promise<void>;
}) {
  const { api } = useWorkspace();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.analyticsStatus>>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!api.isDesktop) return;
    let alive = true;
    const load = () => { void api.analyticsStatus().then((next) => { if (alive) setStatus(next); }).catch(() => { if (alive) setError("Could not read analytics status."); }); };
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, settings.analyticsEnabled]);
  return <section className="card">
    <h3>Help improve Capsule</h3>
    <p className="muted">Optional usage reports help the maintainers measure reliability and performance.
      Reports include a random installation identifier, app version, operating system, harness, runtime route,
      run outcome and duration, and Capsule CPU/memory samples. They never include prompts, code, file paths, credentials or raw logs.</p>
    <SettingRow label="Share usage reports" hint="Off by default. Reports go to our US analytics service. No session recording or automatic click tracking.">
      <input type="checkbox" aria-label="Share usage reports" checked={settings.analyticsEnabled}
        disabled={!api.isDesktop || busy}
        onChange={(event) => {
          setBusy(true); setError(undefined);
          void patch({ analyticsEnabled: event.target.checked })
            .catch(() => setError("Could not save your choice. Please try again."))
            .finally(() => setBusy(false));
        }} />
    </SettingRow>
    <p className="faint">Turning this off discards unsent reports and removes the local identifier.
      Reports already delivered are not erased. Your network address is visible to the receiving service.</p>
    {!api.isDesktop ? <p className="faint">Change this choice on the host computer.</p> : status && <p className="faint" role="status">
      {status.enabled ? status.lastSentAt ? `Last delivery ${new Date(status.lastSentAt).toLocaleString()}` : "Enabled · waiting for the first delivery" : "Collection is off"}
      {status.enabled && status.pending > 0 ? ` · ${status.pending} queued` : ""}
    </p>}
    {(error || status?.error) && <p role="alert" className="settings-keybind-error">{error ?? status?.error}</p>}
  </section>;
}

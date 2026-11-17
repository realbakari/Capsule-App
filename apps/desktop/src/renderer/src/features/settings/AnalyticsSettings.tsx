import { useEffect, useState } from "react";
import type { CapsuleSettings } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { AdvancedRows, SettingRow, Switch } from "./controls";

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
    <SettingRow label="Share usage reports" setting="analyticsEnabled" hint="Off by default. Helps the maintainers measure reliability and speed. Reports never include prompts, code, file paths, credentials or logs.">
      <Switch label="Share usage reports" checked={settings.analyticsEnabled}
        disabled={!api.isDesktop || busy}
        title={api.isDesktop ? undefined : "Change this choice on the host computer."}
        onChange={(analyticsEnabled) => {
          setBusy(true); setError(undefined);
          void patch({ analyticsEnabled })
            .catch(() => setError("Could not save your choice. Please try again."))
            .finally(() => setBusy(false));
        }} />
    </SettingRow>
    <AdvancedRows label="What a report contains">
      <p className="settings-advanced-note">A random installation identifier, the app version, operating system, agent, how the turn ran, its outcome and duration, and Capsule's CPU and memory use. Reports go to a US analytics service, which sees your network address. There is no session recording or click tracking.</p>
      <p className="settings-advanced-note">Turning reports off discards unsent ones and removes the local identifier. Reports already delivered are not erased.</p>
    </AdvancedRows>
    {!api.isDesktop ? <p className="faint">Change this choice on the host computer.</p> : status && <p className="faint" role="status">
      {status.enabled ? status.lastSentAt ? `Last delivery ${new Date(status.lastSentAt).toLocaleString()}` : "Enabled · waiting for the first delivery" : "Collection is off"}
      {status.enabled && status.pending > 0 ? ` · ${status.pending} queued` : ""}
    </p>}
    {(error || status?.error) && <p role="alert" className="settings-keybind-error">{error ?? status?.error}</p>}
  </section>;
}

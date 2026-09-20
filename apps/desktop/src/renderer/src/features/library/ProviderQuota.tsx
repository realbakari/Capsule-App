import { useEffect, useRef, useState } from "react";
import type { ProviderSubscriptionUsage, ProviderUsageSnapshot, ProviderUsageSource, ReportedQuotaWindow } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";

const STALE_AFTER_MS = 5 * 60_000;

export function quotaObservationLabel(report: ProviderSubscriptionUsage, now: number, failed = false): string {
  if (report.observedAtMs - now > STALE_AFTER_MS) return "Reported clock differs from this device";
  return failed || now - report.observedAtMs > STALE_AFTER_MS ? "Last reported · may be out of date" : "Reported observation";
}

function QuotaWindow({ label, quota, now }: { label: string; quota: ReportedQuotaWindow; now: number }) {
  const fill = Math.min(100, quota.usedPercent);
  return <div className="provider-quota-window">
    <div className="provider-quota-window-heading"><span>{label}</span><strong>{quota.usedPercent}% used</strong></div>
    <div className="provider-quota-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={`${quota.usedPercent}% used`}>
      <span style={{ width: `${fill}%` }} data-over-limit={quota.usedPercent >= 100} />
    </div>
    <p>{quota.resetsAtMs <= now ? "Reset time passed; awaiting a new report" : `Resets ${new Date(quota.resetsAtMs).toLocaleString()}`}</p>
  </div>;
}

export function ProviderQuotaCard({ source, now, failed = false }: { source: ProviderUsageSource; now: number; failed?: boolean }) {
  const { report } = source;
  const ageMinutes = Math.floor(Math.max(0, now - report.observedAtMs) / 60_000);
  const duration = report.window.windowDurationMins;
  const windowLabel = duration % 60 === 0 ? `${duration / 60}-hour window` : `${duration}-minute window`;
  return <article className="provider-quota-card" aria-label={`Muse Code subscription reported by ${source.title}`}>
    <header><strong>Muse Code <span>· {report.tier}</span></strong><span>{quotaObservationLabel(report, now, failed)}</span></header>
    <p className="provider-quota-source">From {source.title}</p>
    <p className="provider-quota-observed">As of <time dateTime={new Date(report.observedAtMs).toISOString()}>{new Date(report.observedAtMs).toLocaleString()}</time>
      {report.observedAtMs <= now && ` · ${ageMinutes === 0 ? "less than a minute ago" : `${ageMinutes} min ago`}`}</p>
    <div className="provider-quota-windows">
      <QuotaWindow label={windowLabel} quota={report.window} now={now} />
      <QuotaWindow label="Weekly window" quota={report.weekly} now={now} />
    </div>
  </article>;
}

/** Snapshot reads only. Signals coalesce; no polling of a CLI or provider. */
export function ProviderQuota({ refreshNonce = 0 }: { refreshNonce?: number }) {
  const { api } = useWorkspace();
  const available = typeof api.providerUsage === "function";
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const requestRefresh = useRef(() => {});

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSnapshot(undefined);
    setError(undefined);
    if (!available) return;
    let active = true;
    let reading = false;
    let invalidated = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (!active) return;
      if (reading) { invalidated = true; return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; void read(); }, 0);
    };
    const read = async () => {
      reading = true;
      setLoading(true);
      try {
        const next = await api.providerUsage();
        // An invalidation during this read can mean that a source closed.
        // Read once more before displaying the potentially obsolete response.
        if (active && !invalidated) { setSnapshot(next); setError(undefined); setNow(Date.now()); }
      } catch (failure) {
        if (active && !invalidated) setError(formatUserError(failure));
      } finally {
        reading = false;
        if (active) {
          setLoading(false);
          if (invalidated) { invalidated = false; refresh(); }
        }
      }
    };
    requestRefresh.current = refresh;
    const stateOff = typeof api.on === "function" ? api.on("state", (payload) => {
      if ((payload as { command?: string })?.command === "provider-usage") refresh();
    }) : undefined;
    const connectionOff = typeof api.on === "function" ? api.on("connection", refresh) : undefined;
    refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      stateOff?.(); connectionOff?.();
      requestRefresh.current = () => {};
    };
  }, [api, available]);

  useEffect(() => { requestRefresh.current(); }, [refreshNonce]);
  const reports = snapshot?.reports ?? [];
  const selected = reports.find((source) => source.sessionId === selectedId) ?? reports[0];

  return <section className="card provider-quotas" aria-label="Subscription usage">
    <header className="provider-quotas-heading"><h3>Subscription usage</h3>
      {available && <button className="ghost" type="button" disabled={loading} title="Read the latest cached observation; does not contact the provider" onClick={() => requestRefresh.current()}>Refresh report</button>}
    </header>
    <p className="muted">Observations from running native Muse sessions, separate from transcript tokens. Refresh rereads the latest report, not a live balance.</p>
    {!available ? <p className="muted">Subscription reports are unavailable in this connection. Reopen with an updated desktop app.</p>
      : loading && !snapshot ? <p role="status" className="muted">Reading reported usage…</p>
      : !selected && !error ? <p className="muted">Not reported yet. A running native Muse session must report usage; this page does not start one.</p> : null}
    {error && <p role="alert" className="settings-keybind-error">Could not read subscription reports: {error} Use Refresh report to retry. Previous values may be out of date.</p>}
    {reports.length > 1 && <label className="provider-quota-select">Reported by conversation
      <select value={selected?.sessionId} onChange={(event) => setSelectedId(event.target.value)}>
        {reports.map((source) => <option key={source.sessionId} value={source.sessionId}>{source.title}</option>)}
      </select>
      <small>Sources may use different accounts. Their allowances are not combined.</small>
    </label>}
    {snapshot?.truncated && <p className="muted">Showing the latest 128 reported sources.</p>}
    {selected && <ProviderQuotaCard source={selected} now={now} failed={Boolean(error)} />}
  </section>;
}

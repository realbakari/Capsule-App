import { useEffect, useRef, useState } from "react";
import { harnessDisplayName, type ProviderSubscriptionUsage, type ProviderUsageSnapshot, type ProviderUsageSource, type ReportedQuotaWindow } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { limitTone, pacePercent, resetText } from "./usage-model";

const STALE_AFTER_MS = 5 * 60_000;

export function quotaObservationLabel(report: ProviderSubscriptionUsage, now: number, failed = false): string {
  if (report.observedAtMs - now > STALE_AFTER_MS) return "Reported clock differs from this device";
  return failed || now - report.observedAtMs > STALE_AFTER_MS ? "Last reported · may be out of date" : "Reported observation";
}

const WEEK_MINS = 7 * 24 * 60;
const TONE_NOTE = { ok: "", near: " · near limit", over: " · at limit" } as const;

function QuotaWindow({ label, quota, durationMins, now }: { label: string; quota: ReportedQuotaWindow; durationMins: number; now: number }) {
  const fill = Math.min(100, quota.usedPercent);
  const tone = limitTone(quota.usedPercent);
  const pace = pacePercent(quota.resetsAtMs, durationMins, now);
  return <div className="provider-quota-window" data-tone={tone}>
    <div className="provider-quota-window-heading"><span>{label}</span><strong>{quota.usedPercent}% used{TONE_NOTE[tone]}</strong></div>
    <div className="provider-quota-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={`${quota.usedPercent}% used`}>
      <span style={{ width: `${fill}%` }} data-over-limit={quota.usedPercent >= 100} />
      {pace !== undefined && <i className="provider-quota-pace" style={{ left: `${pace}%` }} title={`Even use would be ${pace}% by now`} aria-hidden />}
    </div>
    <p>{resetText(quota.resetsAtMs, now)}</p>
  </div>;
}

export function ProviderQuotaCard({ source, now, failed = false }: { source: ProviderUsageSource; now: number; failed?: boolean }) {
  const { report } = source;
  const ageMinutes = Math.floor(Math.max(0, now - report.observedAtMs) / 60_000);
  const duration = report.window.windowDurationMins;
  const windowLabel = duration % 60 === 0 ? `${duration / 60}-hour window` : `${duration}-minute window`;
  const agent = harnessDisplayName(report.providerId);
  return <article className="provider-quota-card" aria-label={`${agent} subscription reported by ${source.title}`}>
    <header><strong>{agent} <span>· {report.tier}</span></strong><span>{quotaObservationLabel(report, now, failed)}</span></header>
    <p className="provider-quota-source">From {source.title}</p>
    <p className="provider-quota-observed">As of <time dateTime={new Date(report.observedAtMs).toISOString()}>{new Date(report.observedAtMs).toLocaleString()}</time>
      {report.observedAtMs <= now && ` · ${ageMinutes === 0 ? "less than a minute ago" : `${ageMinutes} min ago`}`}</p>
    <div className="provider-quota-windows">
      <QuotaWindow label={windowLabel} quota={report.window} durationMins={duration} now={now} />
      <QuotaWindow label="Weekly window" quota={report.weekly} durationMins={WEEK_MINS} now={now} />
    </div>
    <p className="provider-quota-legend">The tick on each bar is where even use across the window would be now.</p>
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

  return <section className="card provider-quotas" aria-label="Limits" aria-busy={loading}>
    <header className="provider-quotas-heading"><h3>Limits</h3><span className="usage-source">Reported by running agents</span></header>
    {!available ? <p className="muted">Limit reports are unavailable in this connection. Reopen with an updated desktop app.</p>
      : loading && !snapshot ? <p role="status" className="muted">Reading reported limits…</p>
      : !selected && !error ? <p className="muted">No limits reported. {harnessDisplayName("muse")} reports its plan’s limits while one of its conversations runs. Other agents don’t report limits to Capsule; when a turn stops on one, its conversation says when it resets.</p> : null}
    {error && <p role="alert" className="settings-keybind-error">Could not read limit reports: {error} Use Refresh to retry. Previous values may be out of date.</p>}
    {reports.length > 1 && <label className="provider-quota-select">Reported by conversation
      <select value={selected?.sessionId} onChange={(event) => setSelectedId(event.target.value)}>
        {reports.map((source) => <option key={source.sessionId} value={source.sessionId}>{source.title}</option>)}
      </select>
      <small>Sources may use different accounts. Their allowances are not combined.</small>
    </label>}
    {snapshot?.truncated && <p className="muted">Showing the latest 128 reported sources.</p>}
    {selected && <ProviderQuotaCard source={selected} now={now} failed={Boolean(error)} />}
    {selected && <p className="provider-quota-others">A report is the agent’s last observation, not a live balance. Other agents don’t report limits to Capsule; when a turn stops on one, its conversation says when it resets.</p>}
  </section>;
}

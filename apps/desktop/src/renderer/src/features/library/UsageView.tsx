import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../lib/workspace";

/**
 * Token accounting, read from the coding CLIs' own session transcripts.
 *
 * Cost is deliberately absent. Prices are not in the transcripts, they change,
 * and they differ per plan — a rate table shipped here would be the one number
 * on the page that was invented, and it is the number people would trust most.
 */

interface Bucket {
  key: string;
  totals: Record<string, number>;
  requests: number;
}

interface Summary {
  totals: Record<string, number>;
  requests: number;
  sessions: number;
  byDay: Bucket[];
  byProvider: Bucket[];
  byModel: Bucket[];
  from?: number;
  to?: number;
}

const WINDOWS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const PROVIDER_LABELS: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function sum(totals: Record<string, number>): number {
  return Object.values(totals).reduce((acc, value) => acc + value, 0);
}

/**
 * A share, never rounded to "0%" for something that did happen. A model that
 * used a tenth of a percent of the tokens is not the same as one that used
 * none, and the table sorts by size, so those rows sit together at the bottom
 * where the distinction is exactly what is being read.
 */
function share(value: number, total: number): string {
  if (total <= 0 || value <= 0) return "0%";
  const percent = (value / total) * 100;
  if (percent < 0.1) return "<0.1%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

export function UsageView() {
  const { api } = useWorkspace();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = (await api.usageSummary(days)) as Summary;
        if (!cancelled) {
          setSummary(next);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, days, nonce]);

  // One shared maximum, so a bar's height means the same thing on every day.
  const peak = useMemo(
    () => Math.max(1, ...(summary?.byDay ?? []).map((bucket) => sum(bucket.totals))),
    [summary],
  );

  const total = summary ? sum(summary.totals) : 0;

  return (
    <section className="panel">
      <div className="panel-inner usage-page">
        <div className="settings-crumbbar">
          <p className="settings-breadcrumb">
            Usage <span aria-hidden>/</span> last {WINDOWS.find((w) => w.days === days)?.label}
          </p>
          <div className="usage-controls">
            {WINDOWS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={`chip ${days === option.days ? "active-attached" : ""}`}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
            <button type="button" className="ghost" onClick={() => setNonce((n) => n + 1)}>
              Refresh
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Tokens</h3>
          {/* One line. Where the numbers come from is in the docs; what a
              reader needs here is that it includes work done outside Capsule,
              because that is the surprising part. */}
          <p className="muted">
            Includes sessions run outside Capsule. Tokens only — prices are not in the
            transcripts.
          </p>

          {loading && !summary && <p className="muted">Reading transcripts…</p>}
          {error && <p className="settings-keybind-error">Could not read usage: {error}</p>}

          {summary && total === 0 && !loading && (
            <p className="muted">
              No usage in this window. Transcripts appear once a session has run.
            </p>
          )}

          {summary && total > 0 && (
            <>
              <div className="usage-top">
                <div className="usage-figure">
                  <span className="usage-total">{compact(total)}</span>
                  <span className="usage-figure-sub">
                    {summary.requests.toLocaleString()} requests · {summary.sessions.toLocaleString()}{" "}
                    sessions
                  </span>
                  <div className="usage-providers">
                    {summary.byProvider.map((bucket) => {
                      const value = sum(bucket.totals);
                      return (
                        <div className="usage-provider" key={bucket.key}>
                          <span className="usage-provider-head">
                            <span
                              className={`usage-dot usage-dot--${bucket.key}`}
                              aria-hidden
                            />
                            <span className="truncate">
                              {PROVIDER_LABELS[bucket.key] ?? bucket.key}
                            </span>
                            <span className="usage-provider-value">{compact(value)}</span>
                          </span>
                          <span className="usage-provider-sub">
                            {share(value, total)} of tokens · {bucket.requests.toLocaleString()}{" "}
                            requests
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="usage-chart-block">
                  <h4>Tokens per day</h4>
                  <div className="usage-chart-frame">
                    {/* An axis label, because a bar chart without a scale is a
                        decoration: the tallest bar could be a thousand tokens
                        or a billion and it would look the same. */}
                    <span className="usage-axis-max">{compact(peak)}</span>
                    <div className="usage-chart" role="img" aria-label="Tokens per day">
                      {summary.byDay.map((bucket) => {
                        const value = sum(bucket.totals);
                        return (
                          <span
                            key={bucket.key}
                            className="usage-bar"
                            title={`${bucket.key}: ${value.toLocaleString()} tokens`}
                          >
                            <span
                              className="usage-bar-fill"
                              style={{ transform: `scaleY(${Math.max(value / peak, 0.012)})` }}
                            />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="usage-axis-x">
                    <span>{summary.byDay[0]?.key ?? ""}</span>
                    <span>{summary.byDay.at(-1)?.key ?? ""}</span>
                  </div>
                </div>
              </div>

              <h4 className="usage-section">Totals</h4>
              <div className="usage-totals">
                {(
                  [
                    ["Processed", total],
                    ["Cached input", summary.totals.cachedInput ?? 0],
                    ["Fresh input", summary.totals.input ?? 0],
                    ["Cache writes", summary.totals.cacheWrite ?? 0],
                    ["Output", summary.totals.output ?? 0],
                    ["Reasoning", summary.totals.reasoning ?? 0],
                  ] as const
                ).map(([label, value]) => (
                  <div className="usage-figure-cell" key={label}>
                    <span className="usage-cell-label">{label}</span>
                    <span className="usage-cell-value">{compact(value)}</span>
                  </div>
                ))}
              </div>

              <h4 className="usage-section">By model</h4>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col" className="numeric">Share</th>
                    <th scope="col" className="numeric">Requests</th>
                    <th scope="col" className="numeric">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.slice(0, 15).map((bucket) => (
                    <tr key={bucket.key}>
                      <td className="truncate">{bucket.key}</td>
                      <td className="numeric">{share(sum(bucket.totals), total)}</td>
                      <td className="numeric">{bucket.requests.toLocaleString()}</td>
                      <td className="numeric">{compact(sum(bucket.totals))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

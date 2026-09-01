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
      <div className="panel-inner settings-page">
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
          <p className="muted">
            Read from the transcripts Claude Code and Codex already write, so sessions run outside
            Capsule are counted too. Cost is not shown: prices are not in the transcripts.
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
              <div className="usage-headline">
                <span className="usage-total">{compact(total)}</span>
                <span className="muted">
                  tokens · {summary.requests.toLocaleString()} requests ·{" "}
                  {summary.sessions.toLocaleString()} sessions
                </span>
              </div>

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
                        style={{ transform: `scaleY(${value / peak})` }}
                      />
                    </span>
                  );
                })}
              </div>

              <div className="usage-breakdown">
                <h4>By provider</h4>
                {summary.byProvider.map((bucket) => (
                  <div className="usage-row" key={bucket.key}>
                    <span className="truncate">{PROVIDER_LABELS[bucket.key] ?? bucket.key}</span>
                    <span className="usage-share">
                      {Math.round((sum(bucket.totals) / total) * 100)}%
                    </span>
                    <span className="usage-value">{compact(sum(bucket.totals))}</span>
                  </div>
                ))}

                <h4>By model</h4>
                {summary.byModel.slice(0, 12).map((bucket) => (
                  <div className="usage-row" key={bucket.key}>
                    <span className="truncate">{bucket.key}</span>
                    <span className="usage-share">
                      {Math.round((sum(bucket.totals) / total) * 100)}%
                    </span>
                    <span className="usage-value">{compact(sum(bucket.totals))}</span>
                  </div>
                ))}

                <h4>Where the tokens went</h4>
                {(
                  [
                    ["Cached input", "cachedInput"],
                    ["Fresh input", "input"],
                    ["Cache writes", "cacheWrite"],
                    ["Output", "output"],
                    ["Reasoning", "reasoning"],
                  ] as const
                ).map(([label, key]) => (
                  <div className="usage-row" key={key}>
                    <span className="truncate">{label}</span>
                    <span className="usage-share">
                      {Math.round(((summary.totals[key] ?? 0) / total) * 100)}%
                    </span>
                    <span className="usage-value">{compact(summary.totals[key] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

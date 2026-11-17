import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ResultsLeaderboard } from "../best-of-n/Leaderboard";
import { AgentGlyph } from "../shell/AgentGlyph";
import { useWorkspace } from "../../lib/workspace";
import { ProviderQuota } from "./ProviderQuota";
import {
  bucketTokens,
  compactTokens,
  dailySeries,
  dayKey,
  niceCeiling,
  PROVIDER_LABELS,
  projectRows,
  share,
  shortDay,
  TOKEN_TYPES,
  USAGE_RANGES,
  type DayPoint,
  type UsageSummary,
} from "./usage-model";

/*
 * Limits first, because "can I keep working, and until when" is the question
 * this page is opened for. Then tokens, read from the coding CLIs' own
 * transcripts. Cost is deliberately absent: prices are not in the
 * transcripts, they change, and they differ per plan, so a rate table here
 * would be the one invented number on the page and the one people trusted.
 */

const USAGE_WINDOW_KEY = "capsule.usageWindowDays";
const MODEL_ROWS = 15;

function Tile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="usage-tile">
      <span className="usage-tile-label">{label}</span>
      <span className="usage-tile-value">{value}</span>
      {detail && <span className="usage-tile-detail">{detail}</span>}
    </div>
  );
}

interface RankedRow {
  key: string;
  label: ReactNode;
  value: number;
  detail?: string;
}

/** One bar per part on a shared baseline, largest first: parts compare more exactly than slices. */
function RankedBars({ rows, total, label }: { rows: RankedRow[]; total: number; label: string }) {
  const peak = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="usage-ranked" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <span className="usage-ranked-name">{row.label}</span>
          <span className="usage-ranked-track" aria-hidden>
            {row.value > 0 && <span style={{ width: `${(row.value / peak) * 100}%` }} />}
          </span>
          <span className="usage-ranked-value">{compactTokens(row.value)}</span>
          <span className="usage-ranked-detail">{share(row.value, total)}{row.detail ? ` · ${row.detail}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ points, today }: { points: DayPoint[]; today: string }) {
  const [hover, setHover] = useState<number>();
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.tokens)));
  const busiest = points.reduce((best, point) => (point.tokens > best.tokens ? point : best), points[0]!);
  const active = points.filter((point) => point.tokens > 0).length;
  const shown = hover === undefined ? undefined : points[hover];
  const middle = points[Math.floor((points.length - 1) / 2)]!;
  return (
    <figure className="usage-chart-block">
      <figcaption>Tokens per day</figcaption>
      <div className="usage-chart-frame">
        <div className="usage-axis-y" aria-hidden>
          <span>{compactTokens(ceiling)}</span>
          <span>{compactTokens(ceiling / 2)}</span>
          <span>0</span>
        </div>
        <div
          className="usage-chart"
          role="img"
          aria-label={`Tokens per day. ${active} of ${points.length} days had activity; the busiest was ${shortDay(busiest.key)} with ${compactTokens(busiest.tokens)}.`}
          onMouseLeave={() => setHover(undefined)}
        >
          {points.map((point, index) => (
            <span
              key={point.key}
              className="usage-col"
              data-today={point.key === today || undefined}
              data-hover={hover === index || undefined}
              onMouseEnter={() => setHover(index)}
            >
              {point.tokens > 0 && (
                <span className="usage-col-fill" style={{ height: `${(point.tokens / ceiling) * 100}%` }} />
              )}
            </span>
          ))}
          {shown && (
            <span
              className="usage-tip"
              data-side={hover! > points.length / 2 ? "left" : "right"}
              style={{ left: `${((hover! + 0.5) / points.length) * 100}%` }}
            >
              <strong>{shortDay(shown.key)}{shown.key === today ? " · today" : ""}</strong>
              <span>{shown.tokens.toLocaleString()} tokens</span>
              <span>{shown.requests.toLocaleString()} requests</span>
            </span>
          )}
        </div>
        <div className="usage-axis-x" aria-hidden>
          <span>{shortDay(points[0]!.key)}</span>
          {points.length > 2 && <span>{shortDay(middle.key)}</span>}
          <span>Today</span>
        </div>
      </div>
      <details className="usage-days">
        <summary>Daily figures</summary>
        <table className="usage-grid">
          <thead>
            <tr><th scope="col">Day</th><th scope="col" className="numeric">Requests</th><th scope="col" className="numeric">Tokens</th></tr>
          </thead>
          <tbody>
            {points.filter((point) => point.tokens > 0).reverse().map((point) => (
              <tr key={point.key}>
                <td>{shortDay(point.key)}</td>
                <td className="numeric">{point.requests.toLocaleString()}</td>
                <td className="numeric">{point.tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function UsageView() {
  const { api, projects } = useWorkspace();
  const [days, setDays] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(USAGE_WINDOW_KEY));
      return USAGE_RANGES.some((option) => option.days === saved) ? saved : 7;
    } catch {
      return 7;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(USAGE_WINDOW_KEY, String(days));
    } catch {
      // A browser that refuses storage simply forgets.
    }
  }, [days]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [readAt, setReadAt] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = (await api.usageSummary(days)) as UsageSummary;
        if (!cancelled) {
          setSummary(next);
          setReadAt(Date.now());
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

  const today = dayKey(Date.now());
  const points = useMemo(() => dailySeries(summary?.byDay ?? [], days), [summary, days]);
  const total = summary ? bucketTokens(summary.totals) : 0;
  const range = USAGE_RANGES.find((option) => option.days === days)!;
  const todayTokens = points.at(-1)?.tokens ?? 0;
  const hiddenModels = summary ? summary.byModel.slice(MODEL_ROWS) : [];
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);

  return (
    <section className="panel">
      <div className="panel-inner usage-page">
        <div className="settings-crumbbar">
          <p className="settings-breadcrumb">
            Usage <span aria-hidden>/</span> {days === 1 ? "today" : `last ${range.label}`}
          </p>
          <div className="usage-controls">
            <div className="usage-range" role="group" aria-label="Range">
              {USAGE_RANGES.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className="chip"
                  aria-pressed={days === option.days}
                  onClick={() => setDays(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" className="ghost" disabled={loading} onClick={() => setNonce((n) => n + 1)}>
              Refresh
            </button>
          </div>
        </div>

        <ProviderQuota refreshNonce={nonce} />

        <div className="card usage-tokens" aria-busy={loading}>
          <header className="provider-quotas-heading">
            <h3>Tokens</h3>
            <span className="usage-source">
              From transcripts on this computer{readAt ? ` · read ${new Date(readAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
            </span>
          </header>
          <p className="muted">
            Counts {Object.values(PROVIDER_LABELS).join(" and ")}, including sessions run outside Capsule. Other agents’ transcripts are not read yet. Tokens, not a bill.
          </p>

          {loading && !summary && <p role="status" className="muted">Reading transcripts…</p>}
          {error && <p role="alert" className="settings-keybind-error">Could not read usage: {error}{summary ? " Showing the last figures read." : ""}</p>}
          {Boolean(summary?.unavailableSources?.length) && <p role="status" className="settings-keybind-error">
            Some transcripts could not be read ({summary!.unavailableSources!.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(", ")}).
            {" "}Totals may be incomplete. Check folder access and Refresh to retry.
          </p>}

          {summary && total === 0 && !loading && !error && !summary.unavailableSources?.length && (
            <p className="muted">No usage in this window. Transcripts appear once a session has run.</p>
          )}

          {summary && total > 0 && (
            <div className="usage-body">
              <div className="usage-tiles">
                <Tile label="Today" value={compactTokens(todayTokens)} detail="tokens processed" />
                {days > 1 && <Tile label={`Last ${range.label}`} value={compactTokens(total)} detail="tokens processed" />}
                <Tile label="Requests" value={summary.requests.toLocaleString()} detail={`${summary.sessions.toLocaleString()} sessions`} />
                <Tile label="Cost" value={<span className="usage-not-reported">Not reported</span>} detail="Prices aren't in transcripts" />
              </div>

              {days > 1 && <DailyChart points={points} today={today} />}

              <div className="usage-split">
                <section aria-labelledby="usage-by-agent">
                  <h4 id="usage-by-agent" className="usage-section">By agent</h4>
                  <RankedBars
                    label="Tokens by agent"
                    total={total}
                    rows={summary.byProvider.map((bucket) => {
                      const name = PROVIDER_LABELS[bucket.key] ?? bucket.key;
                      return {
                        key: bucket.key,
                        label: <><AgentGlyph id={bucket.key} name={name} size={13} /><span className="truncate">{name}</span></>,
                        value: bucketTokens(bucket.totals),
                        detail: `${bucket.requests.toLocaleString()} requests`,
                      };
                    })}
                  />
                </section>
                {summary.byProject && (
                  <section aria-labelledby="usage-by-project">
                    <h4 id="usage-by-project" className="usage-section">By project</h4>
                    <RankedBars
                      label="Tokens by project"
                      total={total}
                      rows={projectRows(summary.byProject, projectNames).map((row) => ({
                        key: row.key,
                        label: <span className="truncate">{row.label}</span>,
                        value: row.tokens,
                        detail: `${row.requests.toLocaleString()} requests`,
                      }))}
                    />
                  </section>
                )}
                <section aria-labelledby="usage-by-type">
                  <h4 id="usage-by-type" className="usage-section">By type</h4>
                  <RankedBars
                    label="Tokens by type"
                    total={total}
                    rows={TOKEN_TYPES.map((type) => ({ key: type.key, label: type.label, value: summary.totals[type.key] ?? 0 }))
                      .sort((a, b) => b.value - a.value)}
                  />
                </section>
              </div>

              <h4 className="usage-section">By model</h4>
              <div className="usage-grid-scroll">
                <table className="usage-grid">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="numeric">Requests</th>
                      <th scope="col" className="numeric">Tokens</th>
                      <th scope="col" className="numeric">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byModel.slice(0, MODEL_ROWS).map((bucket) => (
                      <tr key={bucket.key}>
                        <td className="truncate">{bucket.key}</td>
                        <td className="numeric">{bucket.requests.toLocaleString()}</td>
                        <td className="numeric">{compactTokens(bucketTokens(bucket.totals))}</td>
                        <td className="numeric">{share(bucketTokens(bucket.totals), total)}</td>
                      </tr>
                    ))}
                    {hiddenModels.length > 0 && (
                      <tr className="usage-grid-more">
                        <td>{hiddenModels.length} more {hiddenModels.length === 1 ? "model" : "models"}</td>
                        <td className="numeric">{hiddenModels.reduce((sum, bucket) => sum + bucket.requests, 0).toLocaleString()}</td>
                        <td className="numeric">{compactTokens(hiddenModels.reduce((sum, bucket) => sum + bucketTokens(bucket.totals), 0))}</td>
                        <td className="numeric">{share(hiddenModels.reduce((sum, bucket) => sum + bucketTokens(bucket.totals), 0), total)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <ResultsLeaderboard key={nonce} />
        </div>
      </div>
    </section>
  );
}

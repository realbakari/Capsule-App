import { useEffect, useState } from "react";
import type { LeaderboardRow } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { AgentGlyph } from "../shell/AgentGlyph";
import "./best-of-n.css";

/** The leaderboard as last read; `undefined` while loading. */
export function useLeaderboard(enabled = true): { rows?: LeaderboardRow[]; error?: string } {
  const { api } = useWorkspace();
  const [state, setState] = useState<{ rows?: LeaderboardRow[]; error?: string }>({});
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    // A host from before this feature has no such channel; that reads as an error, not a crash.
    void Promise.resolve().then(() => api.resultsLeaderboard()).then(
      (rows) => { if (current) setState({ rows }); },
      (error) => { if (current) setState({ error: formatUserError(error) }); },
    );
    return () => { current = false; };
  }, [api, enabled]);
  return state;
}

/** "Kept 3 of 5 · 4 up" for one agent, all its models together; undefined with no history. */
export function leaderboardHint(rows: readonly LeaderboardRow[] | undefined, harnessId: string, model?: string): string | undefined {
  const mine = (rows ?? []).filter((row) => row.harnessId === harnessId && (model === undefined || row.model === model));
  if (!mine.length) return undefined;
  const sum = (key: "compared" | "kept" | "up" | "down") => mine.reduce((total, row) => total + row[key], 0);
  const parts = [];
  if (sum("compared")) parts.push(`Kept ${sum("kept")} of ${sum("compared")}`);
  if (sum("up")) parts.push(`${sum("up")} up`);
  if (sum("down")) parts.push(`${sum("down")} down`);
  return parts.join(" · ") || undefined;
}

/**
 * "Your results": what you kept and how you rated each agent and model. It
 * is read from this computer's history and never leaves it.
 */
export function ResultsLeaderboard({ compact = false }: { compact?: boolean }) {
  const { harnesses } = useWorkspace();
  const { rows, error } = useLeaderboard();
  const name = (id: string) => harnessDisplayName(harnesses ?? [], id, id);
  return (
    <section className={`results-leaderboard${compact ? " compact" : ""}`} aria-labelledby="results-leaderboard-title">
      <h3 id="results-leaderboard-title">Your results</h3>
      <p className="faint">From comparisons you ran and replies you rated on this computer. Nothing here is sent anywhere.</p>
      {error ? <p className="results-leaderboard-error" role="alert">Could not read your results: {error}</p>
        : !rows ? <div className="results-leaderboard-loading" aria-label="Loading your results"><span className="skeleton skeleton-line medium" /><span className="skeleton skeleton-line short" /></div>
        : rows.length === 0 ? <p className="results-leaderboard-empty">No results yet. Run a prompt on several agents and keep the best one, or rate a reply with a thumb.</p>
        : (
          <table>
            <thead>
              <tr><th scope="col">Agent</th><th scope="col">Kept</th><th scope="col" aria-label="Rated good">Up</th><th scope="col" aria-label="Rated poor">Down</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.harnessId}:${row.model}`}>
                  <th scope="row">
                    <span className="results-leaderboard-agent">
                      <AgentGlyph id={row.harnessId} name={name(row.harnessId)} size={13} />
                      <span>{name(row.harnessId)}</span>
                      <small>{row.model || "default model"}</small>
                    </span>
                  </th>
                  <td>{row.compared ? `${row.kept} of ${row.compared}` : "–"}</td>
                  <td>{row.up}</td>
                  <td>{row.down}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}

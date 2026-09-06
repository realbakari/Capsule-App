import { useState } from "react";
import { localTimings, type TimingSnapshot } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";

export function PerformanceDiagnostics() {
  const { api } = useWorkspace();
  const [snapshots, setSnapshots] = useState<Array<{ label: string; value: TimingSnapshot }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function refresh() {
    setBusy(true); setError(undefined);
    try {
      const result = await api.getDiagnostics();
      setSnapshots([...(result.performance ? [{ label: "Desktop host", value: result.performance }] : []), { label: "This window", value: localTimings.snapshot() }]);
    } catch { setError("Could not read timings. Try refreshing again."); }
    finally { setBusy(false); }
  }
  return <section className="card performance-diagnostics">
    <div className="performance-heading"><h3>Local performance</h3><button className="chip" disabled={busy} onClick={() => void refresh()}>{busy ? "Reading…" : "Refresh timings"}</button></div>
    <p className="muted">In-memory timings for this app session: 200 recent samples and 20 slowest per process. No prompts, paths or command arguments. Nothing is sent automatically.</p>
    <p className="faint">Event timings measure processing, not painting or agent response time. Git queue time is separate from process time. Preview time covers local reading and decoding.</p>
    <p className="faint">Errors include non-zero Git probes, which can be normal when a ref or repository does not exist.</p>
    {error && <p role="alert">{error}</p>}
    {snapshots.map(({ label, value }) => <div key={label}>
      <h4>{label}</h4>
      {value.totals.length ? <table><thead><tr><th>Operation</th><th>Count</th><th>Average</th><th>Slowest</th><th>Errors</th></tr></thead><tbody>{value.totals.map((item) => <tr key={item.operation}><td>{item.operation}</td><td>{item.count}</td><td>{(item.totalMs / item.count).toFixed(1)} ms</td><td>{item.maxMs.toFixed(1)} ms</td><td>{item.failures}</td></tr>)}</tbody></table> : <p className="muted">No measurements yet.</p>}
      {value.slowest.length > 0 && <details><summary>Slow samples</summary><ul>{value.slowest.slice(0, 10).map((item, index) => <li key={index}>{item.operation} · {item.milliseconds} ms · {new Date(item.at).toLocaleTimeString()}{item.failed ? " · error" : ""}</li>)}</ul></details>}
    </div>)}
  </section>;
}

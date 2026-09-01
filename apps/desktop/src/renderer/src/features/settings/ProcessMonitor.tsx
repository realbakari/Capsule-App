import { useEffect, useState } from "react";
import { useWorkspace } from "../../lib/workspace";
import {
  formatBytes,
  formatCpu,
  formatUptime,
  processLabel,
  sortByCost,
  totals,
  type ProcessMetric,
} from "../../lib/process-metrics";

const SAMPLE_MS = 2_000;

/**
 * Capsule's own process tree, sampled while this panel is open.
 *
 * Scope is deliberate and stated on the panel: these are the numbers Electron
 * reports for this app. Per-process disk throughput, thermal state and CPU
 * speed limits need a native sampler, and inventing them from nothing would be
 * worse than leaving them out.
 */
export function ProcessMonitor() {
  const { api } = useWorkspace();
  const [metrics, setMetrics] = useState<ProcessMetric[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampledAt, setSampledAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function sample() {
      try {
        const next = (await api.processMetrics()) as ProcessMetric[];
        if (cancelled) return;
        setMetrics(next);
        setSampledAt(Date.now());
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    void sample();
    // Sampling stops with the panel: a timer left running behind a closed tab
    // is exactly the kind of idle cost a resource monitor should not add.
    const id = window.setInterval(() => void sample(), SAMPLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api]);

  const summary = metrics ? totals(metrics) : null;

  return (
    <div className="card">
      <h3>Process monitor</h3>
      <p className="muted">
        Capsule&rsquo;s own processes, sampled every {SAMPLE_MS / 1000} seconds while this panel is
        open. These are the figures Electron reports for this app; disk throughput and thermal
        state need a native sampler Capsule does not ship.
      </p>

      {error && <p className="settings-keybind-error">Could not read metrics: {error}</p>}
      {!metrics && !error && <p className="muted">Sampling…</p>}

      {summary && (
        <>
          <div className="usage-totals">
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Processes</span>
              <span className="usage-cell-value">{summary.processes}</span>
            </div>
            <div className="usage-figure-cell">
              <span className="usage-cell-label">CPU</span>
              <span className="usage-cell-value">{formatCpu(summary.cpuPercent)}</span>
            </div>
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Memory</span>
              <span className="usage-cell-value">{formatBytes(summary.memoryBytes)}</span>
            </div>
          </div>

          <table className="usage-table process-table">
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col" className="numeric">CPU</th>
                <th scope="col" className="numeric">Memory</th>
                <th scope="col" className="numeric">Uptime</th>
                <th scope="col" className="numeric">PID</th>
              </tr>
            </thead>
            <tbody>
              {sortByCost(metrics ?? []).map((metric) => (
                <tr key={metric.pid}>
                  <td className="truncate">{processLabel(metric)}</td>
                  <td className="numeric">{formatCpu(metric.cpuPercent)}</td>
                  <td className="numeric">{formatBytes(metric.memoryBytes)}</td>
                  <td className="numeric">{formatUptime(metric.uptimeMs)}</td>
                  <td className="numeric mono">{metric.pid}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {sampledAt && (
            <p className="muted process-sampled">
              Sampled {new Date(sampledAt).toLocaleTimeString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

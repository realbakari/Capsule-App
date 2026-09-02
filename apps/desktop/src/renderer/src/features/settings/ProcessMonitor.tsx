import { useEffect, useState } from "react";
import { useWorkspace } from "../../lib/workspace";
import {
  coreShare,
  formatBytes,
  formatCpu,
  formatUptime,
  hostConcern,
  idleLabel,
  processLabel,
  sortByCost,
  sparklinePath,
  totals,
  type HostState,
  type ResourceHistoryPoint,
  type ResourceSample,
} from "../../lib/process-metrics";

const REFRESH_MS = 2_000;

/**
 * What Capsule and its agents are costing this machine.
 *
 * The sampling happens in the main process on its own schedule, so the history
 * is already there when the panel opens — a monitor that starts measuring when
 * you look at it can never show you the spike you came to explain.
 */
export function ProcessMonitor() {
  const { api } = useWorkspace();
  const [sample, setSample] = useState<ResourceSample | null>(null);
  const [history, setHistory] = useState<ResourceHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<HostState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function read() {
      try {
        const [next, points, hostNext] = await Promise.all([
          api.processMetrics() as Promise<ResourceSample>,
          api.processHistory() as Promise<ResourceHistoryPoint[]>,
          api.hostState() as Promise<HostState>,
        ]);
        if (cancelled) return;
        setSample(next);
        setHistory(points);
        setHost(hostNext);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    void read();
    const id = window.setInterval(() => void read(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api]);

  const cores = navigator.hardwareConcurrency || 1;
  const appTotals = sample ? totals(sample.app) : null;
  const agentTotals = sample ? totals(sample.agents) : null;
  const agentSeries = history.map((point) => point.agentCpuPercent);
  const appSeries = history.map((point) => point.appCpuPercent);
  const windowMinutes =
    history.length > 1
      ? Math.max(1, Math.round((history[history.length - 1]!.sampledAt - history[0]!.sampledAt) / 60_000))
      : 0;

  return (
    <div className="card">
      <h3>Process monitor</h3>
      <p className="muted">
        Capsule&rsquo;s own processes and the agents it is driving. CPU is percent of one core.
      </p>

      {host && (
        <div className={`host-state host-state--${hostConcern(host)}`}>
          <span>
            <span className="usage-cell-label">Power</span>{" "}
            {host.onBattery ? "Battery" : "Plugged in"}
          </span>
          <span>
            <span className="usage-cell-label">Thermal</span> {host.thermalState}
          </span>
          <span>
            <span className="usage-cell-label">Session</span> {idleLabel(host)}
          </span>
        </div>
      )}

      {error && <p className="settings-keybind-error">Could not read metrics: {error}</p>}
      {!sample && !error && <p className="muted">Sampling…</p>}

      {sample && appTotals && agentTotals && (
        <>
          <div className="usage-totals">
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Agents</span>
              <span className="usage-cell-value">{agentTotals.processes}</span>
            </div>
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Agent CPU</span>
              <span className="usage-cell-value">{formatCpu(agentTotals.cpuPercent)}</span>
              <span className="usage-cell-label">{coreShare(agentTotals.cpuPercent, cores)}</span>
            </div>
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Agent memory</span>
              <span className="usage-cell-value">{formatBytes(agentTotals.memoryBytes)}</span>
            </div>
            <div className="usage-figure-cell">
              <span className="usage-cell-label">Capsule CPU</span>
              <span className="usage-cell-value">{formatCpu(appTotals.cpuPercent)}</span>
              <span className="usage-cell-label">{formatBytes(appTotals.memoryBytes)}</span>
            </div>
          </div>

          {history.length > 1 && (
            <figure className="resource-history">
              <svg viewBox="0 0 240 44" preserveAspectRatio="none" aria-hidden>
                <path className="resource-history-app" d={sparklinePath(appSeries, 240, 44)} />
                <path className="resource-history-agent" d={sparklinePath(agentSeries, 240, 44)} />
              </svg>
              <figcaption>
                CPU over the last {windowMinutes} min — <span className="resource-key-agent">agents</span>{" "}
                against <span className="resource-key-app">Capsule</span>
              </figcaption>
            </figure>
          )}

          <div className="nav-label process-section">Agents</div>
          {sample.agents.length === 0 ? (
            <p className="faint">No agent is running. Start one from a conversation.</p>
          ) : (
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
                {sortByCost(sample.agents).map((metric) => (
                  <tr key={`${metric.pid}-${metric.startTimeMs ?? 0}`}>
                    <td className="truncate">{processLabel(metric)}</td>
                    <td className="numeric">{formatCpu(metric.cpuPercent)}</td>
                    <td className="numeric">{formatBytes(metric.memoryBytes)}</td>
                    <td className="numeric">{formatUptime(metric.uptimeMs)}</td>
                    <td className="numeric mono">{metric.pid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details className="process-section">
            <summary>Capsule&rsquo;s own processes ({appTotals.processes})</summary>
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
                {sortByCost(sample.app).map((metric) => (
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
          </details>

          <p className="muted process-sampled">
            Sampled {new Date(sample.sampledAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
}

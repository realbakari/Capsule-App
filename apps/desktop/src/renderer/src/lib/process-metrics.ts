/**
 * Presentation helpers for the process table in Diagnostics.
 *
 * The numbers come from Electron's own `app.getAppMetrics()`, so this covers
 * the app's process tree — main, renderer, GPU, utility — and nothing else.
 * Per-process disk throughput, thermal state and CPU speed limits are not
 * available to Electron; reporting them would need a native sampler Capsule
 * does not ship, so they are absent rather than estimated.
 */

export interface ProcessMetric {
  pid: number;
  /** Electron's process type: "Browser", "Tab", "GPU", "Utility"… */
  type: string;
  /** Percent of one core, as Electron reports it. */
  cpuPercent: number;
  /** Resident set, in bytes. */
  memoryBytes: number;
  /** Milliseconds since the process started, when known. */
  uptimeMs?: number;
  name?: string;
}

/**
 * Electron's type names are internal ("Browser" is the main process, "Tab" is
 * a renderer). Nobody reading a diagnostics table should have to know that.
 */
const TYPE_LABELS: Record<string, string> = {
  Browser: "Main",
  Tab: "Renderer",
  GPU: "GPU",
  Utility: "Utility",
  Zygote: "Zygote",
  "Sandbox helper": "Sandbox helper",
  "Pepper Plugin": "Plugin",
};

export function processLabel(metric: ProcessMetric): string {
  const base = TYPE_LABELS[metric.type] ?? metric.type;
  // serviceName distinguishes one utility process from another; without it a
  // table of four "Utility" rows says nothing.
  return metric.name && metric.name !== metric.type ? `${base} · ${metric.name}` : base;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatCpu(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  // Under a tenth of a percent is noise, but it is not nothing, and rounding
  // it to 0% makes a running process look stopped. Exactly zero stays "0%".
  if (percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

export function formatUptime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface MetricsTotals {
  processes: number;
  cpuPercent: number;
  memoryBytes: number;
}

export function totals(metrics: readonly ProcessMetric[]): MetricsTotals {
  return {
    processes: metrics.length,
    cpuPercent: metrics.reduce((sum, metric) => sum + (metric.cpuPercent || 0), 0),
    memoryBytes: metrics.reduce((sum, metric) => sum + (metric.memoryBytes || 0), 0),
  };
}

/** Busiest first, so the row that explains a hot fan is at the top. */
export function sortByCost(metrics: readonly ProcessMetric[]): ProcessMetric[] {
  return [...metrics].sort(
    (a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes || a.pid - b.pid,
  );
}

export interface HostState {
  onBattery: boolean;
  idleState: "active" | "idle" | "locked" | "unknown";
  idleSeconds: number;
  thermalState: "unknown" | "nominal" | "fair" | "serious" | "critical";
}

/**
 * Whether a host condition is worth drawing attention to.
 *
 * Only two are: a machine that is throttling, and one running on battery,
 * because both slow the agent down in ways that look like the app being slow.
 * Everything else is context, not a warning.
 */
export function hostConcern(state: HostState): "none" | "notice" | "warn" {
  if (state.thermalState === "serious" || state.thermalState === "critical") return "warn";
  if (state.onBattery) return "notice";
  return "none";
}

export function idleLabel(state: HostState): string {
  if (state.idleState === "locked") return "Locked";
  if (state.idleState === "unknown") return "Unknown";
  if (state.idleState === "idle") return `Idle · ${formatUptime(state.idleSeconds * 1000)}`;
  return "Active";
}

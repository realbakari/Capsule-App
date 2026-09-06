/** Fixed labels only: never store paths, prompts, command arguments or output. */
export const TIMING_OPERATIONS = ["events.main", "events.renderer", "git.process", "git.status", "git.diff", "git.show", "git.refs", "git.snapshot", "git.queue", "preview.read"] as const;
export type TimingOperation = typeof TIMING_OPERATIONS[number];
export interface TimingSample { operation: TimingOperation; milliseconds: number; at: string; failed: boolean }
export interface TimingSnapshot {
  recent: TimingSample[];
  slowest: TimingSample[];
  totals: Array<{ operation: TimingOperation; count: number; failures: number; totalMs: number; maxMs: number }>;
}

/** A process-local ring, not telemetry. Slow outliers survive a burst of fast events. */
export class PerformanceTimings {
  private recent: TimingSample[] = [];
  private slowest: TimingSample[] = [];
  private totals = new Map<TimingOperation, TimingSnapshot["totals"][number]>();
  record(operation: TimingOperation, milliseconds: number, failed = false): void {
    if (!TIMING_OPERATIONS.includes(operation) || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    const sample = { operation, milliseconds: Math.round(milliseconds * 100) / 100, at: new Date().toISOString(), failed };
    this.recent.push(sample);
    if (this.recent.length > 200) this.recent.shift();
    if (this.slowest.length < 20 || sample.milliseconds > this.slowest[this.slowest.length - 1]!.milliseconds) {
      this.slowest.push(sample);
      this.slowest.sort((a, b) => b.milliseconds - a.milliseconds);
      this.slowest.length = Math.min(20, this.slowest.length);
    }
    const total = this.totals.get(operation) ?? { operation, count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    total.count++; total.failures += Number(failed); total.totalMs += sample.milliseconds;
    total.maxMs = Math.max(total.maxMs, sample.milliseconds);
    this.totals.set(operation, total);
  }
  start(operation: TimingOperation): (failed?: boolean) => void {
    const start = performance.now();
    let recorded = false;
    return (failed = false) => {
      if (recorded) return;
      recorded = true;
      this.record(operation, performance.now() - start, failed);
    };
  }
  snapshot(): TimingSnapshot {
    return { recent: this.recent.map((item) => ({ ...item })), slowest: this.slowest.map((item) => ({ ...item })), totals: [...this.totals.values()].map((item) => ({ ...item, totalMs: Math.round(item.totalMs * 100) / 100 })) };
  }
}

export const localTimings = new PerformanceTimings();

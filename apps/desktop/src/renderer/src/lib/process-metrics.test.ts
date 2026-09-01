import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCpu,
  formatUptime,
  processLabel,
  sortByCost,
  totals,
  hostConcern,
  idleLabel,
  type HostState,
  type ProcessMetric,
} from "./process-metrics.js";

const metric = (over: Partial<ProcessMetric> = {}): ProcessMetric => ({
  pid: 1,
  type: "Browser",
  cpuPercent: 0,
  memoryBytes: 0,
  ...over,
});

describe("processLabel", () => {
  it("translates Electron's internal type names", () => {
    // "Browser" is the main process and "Tab" is a renderer; a diagnostics
    // table should not require knowing that.
    expect(processLabel(metric({ type: "Browser" }))).toBe("Main");
    expect(processLabel(metric({ type: "Tab" }))).toBe("Renderer");
  });

  it("keeps an unknown type rather than inventing one", () => {
    expect(processLabel(metric({ type: "Something New" }))).toBe("Something New");
  });

  it("distinguishes one utility process from another", () => {
    expect(processLabel(metric({ type: "Utility", name: "Network Service" }))).toBe(
      "Utility · Network Service",
    );
  });

  it("does not repeat the name when it matches the type", () => {
    expect(processLabel(metric({ type: "GPU", name: "GPU" }))).toBe("GPU");
  });
});

describe("formatBytes", () => {
  it("scales to a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
  });

  it("handles zero and nonsense without printing NaN", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatCpu", () => {
  it("keeps a busy process readable", () => {
    expect(formatCpu(41.42)).toBe("41.4%");
  });

  it("does not round a live process down to zero", () => {
    // An idle-but-running process reading "0%" looks stopped.
    expect(formatCpu(0.04)).toBe("<0.1%");
    expect(formatCpu(0)).toBe("0%");
  });

  it("refuses nonsense", () => {
    expect(formatCpu(Number.NaN)).toBe("0%");
    expect(formatCpu(-3)).toBe("0%");
  });
});

describe("formatUptime", () => {
  it("scales from seconds to days", () => {
    expect(formatUptime(5_000)).toBe("5s");
    expect(formatUptime(90_000)).toBe("1m");
    expect(formatUptime(3 * 3_600_000 + 600_000)).toBe("3h 10m");
    expect(formatUptime(50 * 3_600_000)).toBe("2d 2h");
  });

  it("says nothing when the process did not report a start time", () => {
    expect(formatUptime(undefined)).toBe("—");
    expect(formatUptime(Number.NaN)).toBe("—");
  });
});

describe("totals", () => {
  it("sums cpu and memory across the tree", () => {
    const result = totals([
      metric({ cpuPercent: 10, memoryBytes: 1024 }),
      metric({ cpuPercent: 2.5, memoryBytes: 2048 }),
    ]);
    expect(result).toEqual({ processes: 2, cpuPercent: 12.5, memoryBytes: 3072 });
  });

  it("is zero for an empty tree rather than NaN", () => {
    expect(totals([])).toEqual({ processes: 0, cpuPercent: 0, memoryBytes: 0 });
  });
});

describe("sortByCost", () => {
  it("puts the busiest process first", () => {
    const sorted = sortByCost([
      metric({ pid: 1, cpuPercent: 1 }),
      metric({ pid: 2, cpuPercent: 40 }),
      metric({ pid: 3, cpuPercent: 5 }),
    ]);
    expect(sorted.map((m) => m.pid)).toEqual([2, 3, 1]);
  });

  it("breaks a CPU tie on memory, then pid, so the order is stable", () => {
    const sorted = sortByCost([
      metric({ pid: 9, cpuPercent: 0, memoryBytes: 10 }),
      metric({ pid: 4, cpuPercent: 0, memoryBytes: 99 }),
      metric({ pid: 2, cpuPercent: 0, memoryBytes: 10 }),
    ]);
    expect(sorted.map((m) => m.pid)).toEqual([4, 2, 9]);
  });

  it("does not mutate its input", () => {
    const input = [metric({ pid: 1, cpuPercent: 1 }), metric({ pid: 2, cpuPercent: 9 })];
    sortByCost(input);
    expect(input.map((m) => m.pid)).toEqual([1, 2]);
  });
});

describe("host state", () => {
  const host = (over: Partial<HostState> = {}): HostState => ({
    onBattery: false,
    idleState: "active",
    idleSeconds: 0,
    thermalState: "nominal",
    ...over,
  });

  it("warns only when the machine is actually throttling", () => {
    expect(hostConcern(host({ thermalState: "serious" }))).toBe("warn");
    expect(hostConcern(host({ thermalState: "critical" }))).toBe("warn");
    expect(hostConcern(host({ thermalState: "fair" }))).toBe("none");
    expect(hostConcern(host())).toBe("none");
  });

  it("notices battery, because it slows the agent in a way that looks like the app", () => {
    expect(hostConcern(host({ onBattery: true }))).toBe("notice");
  });

  it("ranks throttling above battery when both are true", () => {
    expect(hostConcern(host({ onBattery: true, thermalState: "critical" }))).toBe("warn");
  });

  it("labels idle with how long, and names locked and unknown", () => {
    expect(idleLabel(host())).toBe("Active");
    expect(idleLabel(host({ idleState: "idle", idleSeconds: 120 }))).toBe("Idle · 2m");
    expect(idleLabel(host({ idleState: "locked" }))).toBe("Locked");
    expect(idleLabel(host({ idleState: "unknown" }))).toBe("Unknown");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Shutdown } from "./shutdown";

afterEach(() => vi.useRealTimers());

describe("desktop shutdown", () => {
  it("waits for cleanup and shares repeated quit requests", async () => {
    let finish!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const shutdown = new Shutdown(cleanup, vi.fn());
    const first = shutdown.request();
    expect(shutdown.request()).toBe(first);
    expect(shutdown.started).toBe(true);
    await Promise.resolve();
    expect(shutdown.ready).toBe(false);
    finish(); await first;
    expect(shutdown.ready).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("finishes at the deadline and consumes delayed failures", async () => {
    vi.useFakeTimers();
    let fail!: (reason: Error) => void;
    const report = vi.fn();
    const shutdown = new Shutdown(() => new Promise((_, reject) => { fail = reject; }), report, 100);
    const pending = shutdown.request();
    await vi.advanceTimersByTimeAsync(100); await pending;
    expect(shutdown.ready).toBe(true);
    expect(report).toHaveBeenCalledOnce();
    fail(new Error("late close failure"));
    await Promise.resolve(); await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports rejected cleanup without blocking quit", async () => {
    const report = vi.fn();
    const shutdown = new Shutdown(async () => { throw new Error("close failed"); }, report);
    await shutdown.request();
    expect(shutdown.ready).toBe(true);
    expect(report).toHaveBeenCalledOnce();
  });
});

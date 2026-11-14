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

  it("quits from a later task, never inside the microtasks of the quit that asked", async () => {
    const quit = vi.fn();
    const shutdown = new Shutdown(async () => {}, vi.fn());
    shutdown.quitWhenDone(quit, vi.fn());
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(shutdown.ready).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(quit).toHaveBeenCalledOnce();
  });

  it("exits outright when the quit does not take", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = new Shutdown(async () => {}, vi.fn());
    shutdown.quitWhenDone(vi.fn(), exit, 1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledOnce();
  });

  it("reports rejected cleanup without blocking quit", async () => {
    const report = vi.fn();
    const shutdown = new Shutdown(async () => { throw new Error("close failed"); }, report);
    await shutdown.request();
    expect(shutdown.ready).toBe(true);
    expect(report).toHaveBeenCalledOnce();
  });
});

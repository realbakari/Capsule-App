import { describe, expect, it, vi } from "vitest";
import { FileSaveCoordinator } from "./file-save.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("FileSaveCoordinator", () => {
  it("coalesces a burst of keystrokes into one write", async () => {
    const persist = vi.fn(async () => {});
    const c = new FileSaveCoordinator({ debounceMs: 5, persist });
    c.change("a"); c.change("ab"); c.change("abc");
    await tick(20);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("abc");
  });

  it("saves again for edits made while a write is in flight", async () => {
    let release: () => void = () => {};
    const persist = vi.fn(async () => { await new Promise<void>((r) => { release = r; }); });
    const c = new FileSaveCoordinator({ debounceMs: 1, persist });
    c.change("first");
    await tick(10);
    expect(persist).toHaveBeenCalledTimes(1);
    // Typed during the in-flight write — this must not be lost.
    c.change("second");
    release();
    await tick(20);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("second");
  });

  it("never runs two writes concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const persist = vi.fn(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await tick(5); inFlight -= 1;
    });
    const c = new FileSaveCoordinator({ debounceMs: 1, persist });
    for (const text of ["a", "b", "c", "d"]) { c.change(text); await tick(2); }
    await tick(40);
    expect(peak).toBe(1);
  });

  it("reports pending true on edit and false once settled", async () => {
    const states: boolean[] = [];
    const c = new FileSaveCoordinator({
      debounceMs: 2, persist: async () => {}, onPendingChange: (p) => states.push(p),
    });
    c.change("x");
    await tick(20);
    expect(states[0]).toBe(true);
    expect(states.at(-1)).toBe(false);
  });

  it("flush writes immediately without waiting for the debounce", async () => {
    const persist = vi.fn(async () => {});
    const c = new FileSaveCoordinator({ debounceMs: 10_000, persist });
    c.change("now");
    await c.flush();
    expect(persist).toHaveBeenCalledWith("now");
  });

  it("dispose does not discard unsaved text", async () => {
    const persist = vi.fn(async () => {});
    const c = new FileSaveCoordinator({ debounceMs: 10_000, persist });
    c.change("unsaved");
    c.dispose();
    await tick(20);
    expect(persist).toHaveBeenCalledWith("unsaved");
  });

  it("retries after a failed write instead of marking it saved", async () => {
    const errors: unknown[] = [];
    let attempt = 0;
    const persist = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("disk full");
    });
    const c = new FileSaveCoordinator({
      debounceMs: 1, persist, onError: (e) => errors.push(e),
    });
    c.change("keep me");
    await tick(15);
    expect(errors).toHaveLength(1);
    // The text was never confirmed, so an explicit flush must try again.
    await c.flush();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there is no change to write", async () => {
    const persist = vi.fn(async () => {});
    const c = new FileSaveCoordinator({ debounceMs: 1, persist });
    await c.flush();
    expect(persist).not.toHaveBeenCalled();
  });
});

import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { pressBrowserKey } from "./browser-keys";

function page() {
  let attached = false;
  const transport = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true; }),
    detach: vi.fn(() => { attached = false; }),
    sendCommand: vi.fn(async () => ({})),
  });
  return { contents: { debugger: transport } as unknown as WebContents, transport };
}

it("does not take over or detach another debugger", async () => {
  const { contents, transport } = page();
  transport.attach();
  const focus = vi.fn();
  await expect(pressBrowserKey(contents, "Enter", focus, () => {})).rejects.toThrow("busy");
  expect(focus).not.toHaveBeenCalled();
  expect(transport.detach).not.toHaveBeenCalled();
});

it("releases its transport without sending a key when the grant changes during focus", async () => {
  const { contents, transport } = page();
  await expect(pressBrowserKey(contents, "Enter", async () => {}, () => { throw new Error("Revoked"); })).rejects.toThrow("Revoked");
  expect(transport.sendCommand).not.toHaveBeenCalled();
  expect(transport.isAttached()).toBe(false);
});

it("times out and detaches without allowing a late continuation to dispatch", async () => {
  vi.useFakeTimers();
  const { contents, transport } = page();
  let finish!: () => void;
  try {
    const pending = pressBrowserKey(contents, "Enter", () => new Promise((resolve) => { finish = resolve; }), () => {});
    const rejected = expect(pending).rejects.toThrow("in time");
    await vi.advanceTimersByTimeAsync(9500);
    await rejected;
    expect(transport.isAttached()).toBe(false);
    finish(); await Promise.resolve();
    expect(transport.sendCommand).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

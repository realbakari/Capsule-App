import { expect, it, vi } from "vitest";
import { RemoteAccessLifecycle } from "./remote-access";

it("stops an in-flight startup when Off supersedes it", async () => {
  const stop = vi.fn(async () => {});
  let ready!: (value: { stop: typeof stop }) => void;
  const start = vi.fn(() => new Promise<{ stop: typeof stop }>((resolve) => { ready = resolve; }));
  const lifecycle = new RemoteAccessLifecycle(start, vi.fn());
  const on = lifecycle.set("network");
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  const off = lifecycle.set("off");
  ready({ stop });
  await Promise.all([on, off]);
  expect(stop).toHaveBeenCalledOnce();
  expect(lifecycle.handle).toBeUndefined();
  expect(lifecycle.reach).toBe("off");
});

it("keeps ownership when stopping fails and supports a subsequent retry", async () => {
  const stop = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  const lifecycle = new RemoteAccessLifecycle(async () => ({ stop }), vi.fn());
  await lifecycle.set("network");
  await lifecycle.set("off");
  expect(lifecycle.reach).toBe("network");
  expect(lifecycle.handle).toBeDefined();
  expect(lifecycle.error).toBe("busy");
  await lifecycle.set("off");
  expect(lifecycle.handle).toBeUndefined();
  expect(lifecycle.error).toBeUndefined();
});

import { describe, expect, it, vi } from "vitest";
import { Startup } from "./startup";

describe("desktop startup ownership", () => {
  it("never boots or reveals a second instance", async () => {
    const startup = new Startup(false);
    const boot = vi.fn();
    await startup.run(boot);
    expect(boot).not.toHaveBeenCalled();
    expect(startup.canOpenWindow).toBe(false);
  });

  it("does not boot when quit arrives before readiness", async () => {
    const startup = new Startup(true);
    const boot = vi.fn();
    const pending = startup.run(boot);
    startup.cancel();
    await pending;
    await startup.run(boot);
    expect(boot).not.toHaveBeenCalled();
    expect(startup.canOpenWindow).toBe(false);
  });

  it("waits for late startup before allowing cleanup to finish", async () => {
    const startup = new Startup(true);
    let finish!: () => void;
    const boot = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = startup.run(boot);
    expect(startup.run(boot)).toBe(pending);
    await Promise.resolve();
    expect(startup.canOpenWindow).toBe(true);
    startup.cancel();
    expect(startup.canOpenWindow).toBe(false);
    const cleanup = vi.fn();
    const stopping = startup.settled().then(cleanup);
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(boot).toHaveBeenCalledOnce();
  });

  it("allows cleanup after a partially failed startup", async () => {
    const startup = new Startup(true);
    await expect(startup.run(async () => { throw new Error("database failed"); })).rejects.toThrow("database failed");
    startup.cancel();
    await expect(startup.settled()).resolves.toBeUndefined();
  });
});

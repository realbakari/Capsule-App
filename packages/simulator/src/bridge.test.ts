import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SimulatorBridge } from "./bridge.js";

describe("SimulatorBridge", () => {
  it("starts idle and refuses commands before a device is connected", async () => {
    const bridge = new SimulatorBridge({ projectDir: "/nowhere", cacheDir: "/nowhere" });
    expect(bridge.status("1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7")).toEqual({ state: "idle" });
    await expect(bridge.command("1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7", { type: "tap", x: 1, y: 1 })).rejects.toThrow(/not connected/);
  });

  it("says why it cannot run when the project is missing", async () => {
    const bridge = new SimulatorBridge({ projectDir: await mkdtemp(path.join(os.tmpdir(), "capsule-bridge-")), cacheDir: "/nowhere" });
    const availability = await bridge.available();
    if (process.platform !== "darwin") {
      expect(availability).toMatchObject({ available: false, detail: expect.stringContaining("macOS") });
    } else {
      expect(availability).toMatchObject({ available: false, detail: expect.stringContaining("missing") });
    }
  });

  it("stops nothing it did not start", () => {
    const bridge = new SimulatorBridge({ projectDir: "/nowhere", cacheDir: "/nowhere" });
    expect(() => bridge.stop("1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7")).not.toThrow();
    expect(() => bridge.stopAll()).not.toThrow();
  });
});

/*
 * The real thing, on request: builds the bridge, starts it on a booted
 * simulator and taps. Needs Xcode and one booted device; a couple of minutes.
 *   CAPSULE_SIMULATOR_LIVE=1 pnpm vitest run packages/simulator
 */
describe.runIf(process.env.CAPSULE_SIMULATOR_LIVE === "1")("SimulatorBridge (live)", () => {
  it("builds, starts and taps a booted simulator", { timeout: 10 * 60_000 }, async () => {
    const { listDevices } = await import("./simctl.js");
    const booted = (await listDevices()).find((device) => device.state === "Booted");
    expect(booted, "boot a simulator first").toBeDefined();
    const bridge = new SimulatorBridge({
      projectDir: path.resolve(__dirname, "../../../apps/desktop/native/simulator-bridge"),
      cacheDir: process.env.CAPSULE_SIMULATOR_CACHE ?? await mkdtemp(path.join(os.tmpdir(), "capsule-bridge-cache-")),
      log: (line) => console.log(line),
    });
    try {
      expect(await bridge.available()).toEqual({ available: true });
      const size = await bridge.ensure(booted!.udid);
      expect(size.width).toBeGreaterThan(0);
      expect(bridge.status(booted!.udid)).toMatchObject({ state: "ready", width: size.width });
      await bridge.command(booted!.udid, { type: "home" });
      await bridge.command(booted!.udid, { type: "tap", x: size.width / 2, y: size.height / 2 });
      await expect(bridge.command(booted!.udid, { type: "text", text: "x", candidates: [] })).rejects.toThrow(/focused/);
    } finally {
      bridge.stopAll();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { RunEvent } from "@capsule/shared";
import { agentSimulatorActivity } from "./simulator-activity";

const now = Date.parse("2026-11-14T10:00:30Z");
const event = (message: string, seconds: number, runId = "r", data?: Record<string, unknown>): RunEvent =>
  ({ id: message, runId, type: "tool", message, timestamp: new Date(now - seconds * 1000).toISOString(), data });
const device = { udid: "ABC-123", name: "iPhone 17 Pro" };

describe("agent simulator activity", () => {
  it("sees a recent simctl or xcodebuild step in the running turn", () => {
    expect(agentSimulatorActivity([event("Ran xcrun simctl io booted screenshot", 5)], "r", device, now)).toEqual({ active: true, device: false });
    expect(agentSimulatorActivity([event("Bash", 3, "r", { command: "xcodebuild -scheme App -destination 'id=ABC-123'" })], "r", device, now)).toEqual({ active: true, device: true });
  });
  it("names the device only when the step does", () => {
    expect(agentSimulatorActivity([event("Launch on iPhone 17 Pro simulator", 2)], "r", device, now).device).toBe(true);
  });
  it("ignores old steps, other turns, and unrelated work", () => {
    expect(agentSimulatorActivity([event("xcrun simctl boot", 60)], "r", device, now).active).toBe(false);
    expect(agentSimulatorActivity([event("xcrun simctl boot", 2, "other")], "r", device, now).active).toBe(false);
    expect(agentSimulatorActivity([event("pnpm test", 2)], "r", device, now).active).toBe(false);
    expect(agentSimulatorActivity([event("xcrun simctl boot", 2)], undefined, device, now).active).toBe(false);
  });
});

import type { RunEvent } from "@capsule/shared";

/** How long after its last simulator step the agent still counts as using one. */
export const AGENT_SIMULATOR_WINDOW_MS = 20_000;

const SIMULATOR_WORK = /\b(simctl|xcodebuild|xcrun|ios[ _-]?simulator|simulator)\b/i;

/**
 * Whether the running turn is driving a simulator, read from its own recent
 * tool steps. Capsule does not see the agent's simulator calls directly, so
 * this is what the turn reports: a `simctl` or `xcodebuild` command, or a tool
 * named for the simulator. `device` is true when the step names this device.
 */
export function agentSimulatorActivity(
  events: RunEvent[],
  runId: string | undefined,
  device: { udid: string; name: string } | undefined,
  now = Date.now(),
): { active: boolean; device: boolean } {
  if (!runId) return { active: false, device: false };
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.runId !== runId) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isFinite(at) && now - at > AGENT_SIMULATOR_WINDOW_MS) break;
    const text = `${event.message} ${event.data ? JSON.stringify(event.data) : ""}`;
    if (!SIMULATOR_WORK.test(text)) continue;
    const named = Boolean(device && (text.includes(device.udid) || text.includes(device.name)));
    return { active: true, device: named };
  }
  return { active: false, device: false };
}

import { nativeImage } from "electron";
import { assertBundleId, assertOpenableUrl, launch, listApps, listDevices, openUrl, screenshot } from "@capsule/simulator";
import { localTimings } from "@capsule/shared";
import { startLocalMcpServer, toolSchema, type LocalMcpServer, type LocalToolResult } from "./local-mcp";
import { attachedSimulator, simulatorTouch } from "./simulator";

/**
 * Simulator tools for agents Capsule spawns itself. An agent reaches exactly
 * one device: the one the user attached in that thread's Simulator panel.
 * There is no list-and-pick, no boot, no shutdown and no settings changes
 * here; those stay with the person. Dispatch is not proof: every mutating
 * tool says so and the agent is expected to take a screenshot afterwards.
 */

export interface SimulatorTarget {
  threadId: string;
  allowed: () => boolean;
}

const point = { type: "number", minimum: 0, maximum: 10000 };

export const SIMULATOR_TOOLS = [
  { name: "simulator_status", description: "Which iOS Simulator this thread may use, its state, and its screen size in points (the coordinate space for taps). Fails when no simulator is attached in Capsule's Simulator panel.", inputSchema: toolSchema() },
  { name: "simulator_screenshot", description: "Capture the attached simulator's whole screen as a bounded JPEG. Use it to verify what a tap or launch did.", inputSchema: toolSchema() },
  { name: "simulator_tap", description: "Tap at a point (x, y in points, origin top-left). Takes about a second. Not proof of success: screenshot afterwards.", inputSchema: toolSchema({ x: point, y: point }, ["x", "y"]) },
  { name: "simulator_swipe", description: "Drag from one point to another in points; a scroll is a swipe. Optional duration in milliseconds (50 to 5000).", inputSchema: toolSchema({ fromX: point, fromY: point, toX: point, toY: point, durationMs: { type: "number", minimum: 50, maximum: 5000 } }, ["fromX", "fromY", "toX", "toY"]) },
  { name: "simulator_type", description: "Type text into the field that currently has keyboard focus on the device. Tap a field first; fails when no keyboard is up.", inputSchema: toolSchema({ text: { type: "string", maxLength: 2000 } }, ["text"]) },
  { name: "simulator_key", description: "Press Return or Delete on the device keyboard.", inputSchema: toolSchema({ key: { type: "string", enum: ["return", "delete"] } }, ["key"]) },
  { name: "simulator_home", description: "Press the Home button.", inputSchema: toolSchema() },
  { name: "simulator_open_url", description: "Open a URL or deep link (any scheme except file and javascript) on the device.", inputSchema: toolSchema({ url: { type: "string", maxLength: 2048 } }, ["url"]) },
  { name: "simulator_apps", description: "List the user-installed apps on the device with their bundle identifiers.", inputSchema: toolSchema() },
  { name: "simulator_launch", description: "Launch an installed app by bundle identifier. Build and install with your own tools first; this does not install. Not proof it is in the foreground: screenshot afterwards.", inputSchema: toolSchema({ bundleId: { type: "string", maxLength: 255 } }, ["bundleId"]) },
] as const;

async function resolveDevice(target: SimulatorTarget): Promise<{ udid: string; name: string } | LocalToolResult> {
  if (!target.allowed()) return { ok: false, detail: "Agent simulator access is turned off in Capsule's settings." };
  const udid = attachedSimulator(target.threadId);
  if (!udid) return { ok: false, detail: "No simulator is attached to this conversation. Ask the user to open the Simulator panel and choose Attach." };
  const device = (await listDevices()).find((item) => item.udid === udid);
  if (!device) return { ok: false, detail: "The attached simulator no longer exists. Ask the user to attach another." };
  if (device.state !== "Booted") return { ok: false, detail: `The attached simulator (${device.name}) is ${device.state.toLowerCase()}. Ask the user to start it from the Simulator panel.` };
  return { udid, name: device.name };
}

const isFailure = (value: unknown): value is LocalToolResult => typeof (value as LocalToolResult)?.ok === "boolean";

async function touchReady(udid: string): Promise<{ width: number; height: number }> {
  const bridge = simulatorTouch();
  const status = bridge.status(udid);
  if (status.state === "ready") return { width: status.width, height: status.height };
  const availability = await bridge.available();
  if (!availability.available) throw new Error(availability.detail ?? "Touch input is unavailable on this Mac.");
  bridge.retry(udid);
  return bridge.ensure(udid);
}

const number = (value: unknown, name: string, max = 10_000): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name} must be a number between 0 and ${max}.`);
  return value;
};

export async function callSimulatorTool(target: SimulatorTarget, name: string, args: Record<string, unknown>): Promise<LocalToolResult> {
  const device = await resolveDevice(target);
  if (isFailure(device)) return device;
  const bridge = simulatorTouch();
  const after = "Dispatched; not proof of the result. Take simulator_screenshot to check.";
  switch (name) {
    case "simulator_status": {
      const status = bridge.status(device.udid);
      return { ok: true, detail: `${device.name} is booted. Touch input: ${status.state}.`, data: { udid: device.udid, name: device.name, touch: status } };
    }
    case "simulator_screenshot": {
      let image = nativeImage.createFromBuffer(await screenshot(device.udid));
      const size = image.getSize();
      if (!size.width) return { ok: false, detail: "The simulator returned no frame." };
      const ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
      if (ratio < 1) image = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) });
      const status = bridge.status(device.udid);
      return { ok: true, detail: "The whole simulator screen; it may show sensitive content.", data: { pixels: size, ...(status.state === "ready" ? { points: { width: status.width, height: status.height } } : {}) }, image: { data: image.toJPEG(75).toString("base64"), mimeType: "image/jpeg" } };
    }
    case "simulator_tap": {
      await touchReady(device.udid);
      await bridge.command(device.udid, { type: "tap", x: number(args.x, "x"), y: number(args.y, "y") });
      return { ok: true, detail: after };
    }
    case "simulator_swipe": {
      await touchReady(device.udid);
      const duration = args.durationMs === undefined ? 100 : number(args.durationMs, "durationMs", 5_000);
      await bridge.command(device.udid, { type: "swipe", x: number(args.fromX, "fromX"), y: number(args.fromY, "fromY"), toX: number(args.toX, "toX"), toY: number(args.toY, "toY"), duration: Math.max(duration, 50) / 1000 });
      return { ok: true, detail: after };
    }
    case "simulator_type": {
      await touchReady(device.udid);
      if (typeof args.text !== "string" || !args.text || args.text.length > 2_000) return { ok: false, detail: "text must be 1 to 2000 characters." };
      const apps = await listApps(device.udid).catch(() => []);
      await bridge.command(device.udid, { type: "text", text: args.text, candidates: apps.filter((app) => app.type === "User").map((app) => app.bundleId) });
      return { ok: true, detail: after };
    }
    case "simulator_key": {
      await touchReady(device.udid);
      if (args.key !== "return" && args.key !== "delete") return { ok: false, detail: "key must be return or delete." };
      const apps = await listApps(device.udid).catch(() => []);
      await bridge.command(device.udid, { type: "key", key: args.key, candidates: apps.filter((app) => app.type === "User").map((app) => app.bundleId) });
      return { ok: true, detail: after };
    }
    case "simulator_home": {
      await touchReady(device.udid);
      await bridge.command(device.udid, { type: "home" });
      return { ok: true, detail: after };
    }
    case "simulator_open_url": {
      await openUrl(device.udid, assertOpenableUrl(args.url));
      return { ok: true, detail: after };
    }
    case "simulator_apps": {
      const apps = (await listApps(device.udid)).filter((app) => app.type === "User");
      return { ok: true, detail: apps.length ? `${apps.length} user app(s) installed.` : "No user apps are installed on this simulator.", data: apps };
    }
    case "simulator_launch": {
      await launch(device.udid, assertBundleId(args.bundleId));
      return { ok: true, detail: after };
    }
    default: return { ok: false, detail: `No such tool: ${name}.` };
  }
}

export type SimulatorMcpServer = LocalMcpServer<SimulatorTarget>;

export function startSimulatorMcpServer(admit?: (operation: () => Promise<Record<string, unknown> | undefined>) => Promise<Record<string, unknown> | undefined>): Promise<SimulatorMcpServer> {
  return startLocalMcpServer<SimulatorTarget>({
    name: "capsule-simulator",
    version: "1",
    tools: SIMULATOR_TOOLS,
    admit: async (operation) => {
      const finish = localTimings.start("simulator.tool");
      try { return await (admit ? admit(operation) : operation()); } finally { finish(false); }
    },
    call: callSimulatorTool,
  });
}

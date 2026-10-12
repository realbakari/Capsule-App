import path from "node:path";
import { app, nativeImage } from "electron";
import type { Simulator, SimulatorAction, SimulatorActionResult, SimulatorApp, SimulatorDeviceSettings, SimulatorFrame, SimulatorInventory, SimulatorOrientation } from "@capsule/shared";
import {
  SimulatorBridge,
  appearance,
  assertUdid,
  boot,
  clearLocation,
  contentSize,
  increaseContrast,
  isRecording,
  launch,
  listApps,
  listDevices,
  openUrl,
  push,
  reveal,
  screenshot,
  setAppearance,
  setContentSize,
  setIncreaseContrast,
  setLocation,
  setPrivacy,
  setStatusBar,
  shutdown,
  startRecording,
  stopAllRecordings,
  stopRecording,
  support,
  terminate,
} from "@capsule/simulator";

/**
 * The desktop side of the Simulator surface. The package speaks `simctl` and
 * runs the touch bridge; this module bounds what crosses IPC: one capture in
 * flight per device, a JPEG small enough to send a few times a second, and
 * one typed action per control so the renderer never hands main a command
 * line. The bridge is built on first use into the profile's cache.
 */

/** Longest edge of a frame sent to the renderer. A 3x iPhone frame is ~2900px tall. */
const FRAME_MAX_EDGE = 1200;
const FRAME_QUALITY = 72;

const inFlight = new Map<string, Promise<SimulatorFrame>>();
let bridge: SimulatorBridge | undefined;

function touchBridge(): SimulatorBridge {
  bridge ??= new SimulatorBridge({
    projectDir: app.isPackaged ? path.join(process.resourcesPath, "simulator-bridge") : path.join(__dirname, "../../native/simulator-bridge"),
    cacheDir: path.join(app.getPath("userData"), "simulator-bridge"),
    log: (line) => console.log(line),
  });
  return bridge;
}

export function stopSimulatorBridges(): void {
  bridge?.stopAll();
  stopAllRecordings();
}

/*
 * Which simulator each thread's agent may see and drive. Set only from the
 * panel's Attach control; an agent cannot attach a device for itself, and
 * detaching cuts a running agent off at its next call.
 */
const attached = new Map<string, string>();

export function attachSimulator(threadId: unknown, udid: unknown): void {
  if (typeof threadId !== "string" || !threadId) throw new Error("Attach needs a conversation.");
  if (udid === undefined || udid === null) { attached.delete(threadId); return; }
  attached.set(threadId, assertUdid(udid));
}

export function attachedSimulator(threadId: string): string | undefined {
  return attached.get(threadId);
}

/** The bridge, for the agent tools: they share the panel's sessions. */
export function simulatorTouch(): SimulatorBridge {
  return touchBridge();
}

export async function simulatorSettings(udid: unknown): Promise<SimulatorDeviceSettings> {
  const id = assertUdid(udid);
  const [style, size, contrast] = await Promise.all([
    appearance(id).catch(() => "unknown" as const),
    contentSize(id).catch(() => undefined),
    increaseContrast(id).catch(() => undefined),
  ]);
  const touch = bridge?.status(id);
  let orientation: SimulatorOrientation | undefined;
  if (touch?.state === "ready") {
    const status = await bridge!.command(id, { type: "status" }).catch(() => undefined);
    if (typeof status?.orientation === "string") orientation = status.orientation as SimulatorOrientation;
  }
  return {
    ...(style === "light" || style === "dark" ? { appearance: style } : {}),
    ...(size ? { contentSize: size } : {}),
    ...(contrast !== undefined ? { increaseContrast: contrast } : {}),
    ...(orientation ? { orientation } : {}),
    recording: isRecording(id),
  };
}

export async function simulatorInventory(): Promise<SimulatorInventory> {
  const availability = await support();
  if (!availability.supported) return { supported: false, reason: availability.reason, devices: [] };
  const [devices, touch] = await Promise.all([listDevices(), touchBridge().available()]);
  return {
    supported: true,
    devices: devices.map((device): Simulator => ({
      ...device,
      touch: touch.available ? touchBridge().status(device.udid) : { state: "unavailable", detail: touch.detail ?? "Touch input is unavailable." },
      recording: isRecording(device.udid),
    })),
  };
}

/** The user's own apps first: when typing, the foreground one is where the keyboard is. */
const appCache = new Map<string, { at: number; apps: SimulatorApp[] }>();

export async function simulatorApps(udid: unknown): Promise<SimulatorApp[]> {
  const id = assertUdid(udid);
  const apps = await listApps(id);
  appCache.set(id, { at: Date.now(), apps });
  return apps;
}

async function typingCandidates(udid: string): Promise<string[]> {
  const cached = appCache.get(udid);
  const apps = cached && Date.now() - cached.at < 60_000 ? cached.apps : await simulatorApps(udid).catch(() => cached?.apps ?? []);
  // User apps, then the system apps a person is likely to be typing into.
  return [...apps.filter((item) => item.type === "User").map((item) => item.bundleId), "com.apple.Preferences", "com.apple.mobilesafari", "com.apple.MobileSMS", "com.apple.mobilenotes"].slice(0, 40);
}

/** Coalesce: a renderer asking twice while a capture runs gets the same frame. */
export function simulatorFrame(udid: unknown): Promise<SimulatorFrame> {
  const id = assertUdid(udid);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const capture = (async () => {
    const png = await screenshot(id);
    const image = nativeImage.createFromBuffer(png);
    const { width, height } = image.getSize();
    if (!width || !height) throw new Error("The simulator did not return a frame. Is it booted?");
    const longest = Math.max(width, height);
    const scaled = longest > FRAME_MAX_EDGE ? image.resize(width >= height ? { width: FRAME_MAX_EDGE } : { height: FRAME_MAX_EDGE }) : image;
    const touch = bridge?.status(id);
    return {
      udid: id,
      dataUrl: `data:image/jpeg;base64,${scaled.toJPEG(FRAME_QUALITY).toString("base64")}`,
      pixelWidth: width,
      pixelHeight: height,
      ...(touch?.state === "ready" ? { pointWidth: touch.width, pointHeight: touch.height } : {}),
      capturedAt: new Date().toISOString(),
    } satisfies SimulatorFrame;
  })();
  inFlight.set(id, capture);
  void capture.finally(() => { if (inFlight.get(id) === capture) inFlight.delete(id); });
  return capture;
}

function isAction(value: unknown): value is SimulatorAction {
  return Boolean(value) && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function point(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) throw new Error(`Invalid ${name} coordinate.`);
  return Math.round(value * 10) / 10;
}

const seconds = (durationMs: unknown, fallback: number, max: number) =>
  Math.min(Math.max(typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : fallback, 50), max) / 1000;

const ORIENTATIONS: SimulatorOrientation[] = ["portrait", "landscapeLeft", "landscapeRight", "portraitUpsideDown"];

function recordingFile(id: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(app.getPath("downloads"), `Simulator ${id.slice(0, 8)} ${stamp}.mp4`);
}

/** One switch, one validated operation each; unknown types fail rather than pass through. */
export async function simulatorAct(udid: unknown, action: unknown): Promise<SimulatorActionResult | void> {
  const id = assertUdid(udid);
  if (!isAction(action)) throw new Error("Unknown simulator action.");
  const touch = touchBridge();
  switch (action.type) {
    case "boot": return boot(id);
    case "shutdown":
      touch.stop(id);
      if (isRecording(id)) await stopRecording(id).catch(() => undefined);
      return shutdown(id);
    case "rotate":
      if (!ORIENTATIONS.includes(action.orientation)) throw new Error("Unknown orientation.");
      await touch.command(id, { type: "orientation", value: action.orientation });
      return;
    case "contentSize":
      if (action.size !== "increment" && action.size !== "decrement") throw new Error("Text size changes one step at a time.");
      return setContentSize(id, action.size);
    case "contrast": return setIncreaseContrast(id, action.enabled === true);
    case "statusBar":
      if (action.mode !== "clean" && action.mode !== "clear") throw new Error("Unknown status bar mode.");
      return setStatusBar(id, action.mode);
    case "location": return setLocation(id, action.latitude, action.longitude);
    case "clearLocation": return clearLocation(id);
    case "push":
      if (typeof action.title !== "string" || typeof action.body !== "string") throw new Error("A notification needs a title and a body.");
      return push(id, action.bundleId, action.title, action.body);
    case "privacy": return setPrivacy(id, action.action, action.service, typeof action.bundleId === "string" && action.bundleId ? action.bundleId : undefined);
    case "record":
      if (action.mode === "start") { startRecording(id, recordingFile(id)); return; }
      if (action.mode === "stop") return { file: await stopRecording(id) };
      throw new Error("Unknown recording mode.");
    case "reveal": return reveal(id);
    case "appearance":
      if (action.style !== "light" && action.style !== "dark") throw new Error("Choose light or dark.");
      return setAppearance(id, action.style);
    case "openUrl": return openUrl(id, action.url);
    case "launch": return launch(id, action.bundleId);
    case "terminate": return terminate(id, action.bundleId);
    case "connect": {
      const availability = await touch.available();
      if (!availability.available) throw new Error(availability.detail ?? "Touch input is unavailable.");
      touch.retry(id);
      await touch.ensure(id);
      return;
    }
    case "tap": await touch.command(id, { type: "tap", x: point(action.x, "x"), y: point(action.y, "y") }); return;
    case "press": await touch.command(id, { type: "press", x: point(action.x, "x"), y: point(action.y, "y"), duration: seconds(action.durationMs, 800, 10_000) }); return;
    case "swipe":
      await touch.command(id, { type: "swipe", x: point(action.fromX, "x"), y: point(action.fromY, "y"), toX: point(action.toX, "x"), toY: point(action.toY, "y"), duration: seconds(action.durationMs, 100, 5_000) });
      return;
    case "text":
      if (typeof action.text !== "string" || action.text.length === 0 || action.text.length > 2_000) throw new Error("Type up to 2,000 characters at a time.");
      await touch.command(id, { type: "text", text: action.text, candidates: await typingCandidates(id) });
      return;
    case "key":
      if (action.key !== "return" && action.key !== "delete") throw new Error("Unknown key.");
      await touch.command(id, { type: "key", key: action.key, candidates: await typingCandidates(id) });
      return;
    case "button":
      if (action.name !== "HOME") throw new Error("Unknown simulator button.");
      await touch.command(id, { type: "home" });
      return;
    default: throw new Error("Unknown simulator action.");
  }
}

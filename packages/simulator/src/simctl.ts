import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Simulator, SimulatorApp } from "@capsule/shared";

/**
 * A thin wrapper over Apple's `simctl`, the command-line face of the iOS
 * Simulator. Capsule does not install anything or load CoreSimulator itself:
 * what Xcode ships is enough to list, boot, capture and configure a device,
 * and anything it cannot do (touch input) is a separately detected bridge.
 */

const RUNTIME_PREFIX = "com.apple.CoreSimulator.SimRuntime.";
const DEVICE_TYPE_PREFIX = "com.apple.CoreSimulator.SimDeviceType.";

export interface SimctlDeviceRow {
  udid?: unknown;
  name?: unknown;
  state?: unknown;
  isAvailable?: unknown;
  deviceTypeIdentifier?: unknown;
  lastBootedAt?: unknown;
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-4` → `iOS 26.4`. */
export function runtimeLabel(key: string): string {
  const raw = key.startsWith(RUNTIME_PREFIX) ? key.slice(RUNTIME_PREFIX.length) : key;
  const dash = raw.indexOf("-");
  if (dash < 0) return raw;
  return `${raw.slice(0, dash)} ${raw.slice(dash + 1).replaceAll("-", ".")}`;
}

/** The product line a device type belongs to, from its identifier. */
export function familyFor(deviceTypeIdentifier: string): Simulator["family"] {
  const type = deviceTypeIdentifier.startsWith(DEVICE_TYPE_PREFIX)
    ? deviceTypeIdentifier.slice(DEVICE_TYPE_PREFIX.length)
    : deviceTypeIdentifier;
  if (type.startsWith("iPhone")) return "iPhone";
  if (type.startsWith("iPad")) return "iPad";
  if (type.startsWith("Apple-Watch")) return "Apple Watch";
  if (type.startsWith("Apple-TV")) return "Apple TV";
  if (type.startsWith("Apple-Vision")) return "Apple Vision";
  return "Other";
}

function stateOf(value: unknown): Simulator["state"] {
  switch (value) {
    case "Booted":
    case "Booting":
    case "Shutdown":
    case "Shutting Down":
      return value;
    default:
      return "Unknown";
  }
}

const STATE_ORDER: Record<Simulator["state"], number> = { Booted: 0, Booting: 1, "Shutting Down": 2, Shutdown: 3, Unknown: 4 };

/**
 * Parse `simctl list devices available -j`. Unavailable devices (a runtime
 * that is no longer installed) are already excluded by the flag; a row with
 * no UDID is skipped rather than shown as an unusable card. Booted devices
 * come first, then by last boot, so the one being worked on is at the top.
 */
/** A device before the desktop attaches its touch-bridge state. */
export type SimctlDevice = Omit<Simulator, "touch" | "recording">;

export function parseDeviceList(json: string): SimctlDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The simulator list could not be read.");
  }
  const devices = (parsed as { devices?: unknown })?.devices;
  if (!devices || typeof devices !== "object") throw new Error("The simulator list could not be read.");
  const out: SimctlDevice[] = [];
  for (const [runtimeKey, rows] of Object.entries(devices as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as SimctlDeviceRow[]) {
      if (typeof row?.udid !== "string" || typeof row.name !== "string") continue;
      if (row.isAvailable === false) continue;
      const deviceType = typeof row.deviceTypeIdentifier === "string" ? row.deviceTypeIdentifier : "";
      out.push({
        udid: row.udid,
        name: row.name,
        runtime: runtimeLabel(runtimeKey),
        family: familyFor(deviceType),
        state: stateOf(row.state),
        ...(typeof row.lastBootedAt === "string" ? { lastBootedAt: row.lastBootedAt } : {}),
      });
    }
  }
  return out.sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    const bootA = a.lastBootedAt ?? "";
    const bootB = b.lastBootedAt ?? "";
    if (bootA !== bootB) return bootA < bootB ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parse the JSON form of `simctl listapps` (its native output is an old-style
 * property list, converted with `plutil` before it gets here). User apps
 * first: the one being developed is why the panel is open.
 */
export function parseAppList(json: string): SimulatorApp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The installed app list could not be read.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The installed app list could not be read.");
  const apps: SimulatorApp[] = [];
  for (const [bundleId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const row = value as { CFBundleDisplayName?: unknown; CFBundleName?: unknown; ApplicationType?: unknown };
    const name =
      (typeof row?.CFBundleDisplayName === "string" && row.CFBundleDisplayName) ||
      (typeof row?.CFBundleName === "string" && row.CFBundleName) ||
      bundleId;
    apps.push({ bundleId, name, type: row?.ApplicationType === "User" ? "User" : "System" });
  }
  return apps.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "User" ? -1 : 1));
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run one tool with a hard timeout; a hung CoreSimulator call must not hang the panel. */
export function run(file: string, args: string[], timeoutMs = 15_000, input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || error.message || "").trim().split("\n").at(-1) ?? "";
        reject(new Error(detail || `${file} ${args[0] ?? ""} failed.`));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
  });
}

export const simctl = (args: string[], timeoutMs?: number) => run("xcrun", ["simctl", ...args], timeoutMs);

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** A device argument is a UDID. "booted" is ambiguous with several running and is never accepted. */
export function assertUdid(udid: unknown): string {
  if (typeof udid !== "string" || !UDID.test(udid)) throw new Error("Choose a simulator first.");
  return udid;
}

export async function listDevices(): Promise<SimctlDevice[]> {
  const { stdout } = await simctl(["list", "devices", "available", "-j"]);
  return parseDeviceList(stdout);
}

export async function listApps(udid: string): Promise<SimulatorApp[]> {
  const { stdout } = await simctl(["listapps", assertUdid(udid)]);
  const json = await run("plutil", ["-convert", "json", "-o", "-", "-"], 10_000, stdout);
  return parseAppList(json.stdout);
}

export async function boot(udid: string): Promise<void> {
  try {
    await simctl(["boot", assertUdid(udid)], 60_000);
  } catch (error) {
    // Booting an already-booted device is an error to simctl and a no-op to us.
    if (!/current state: Booted/i.test(error instanceof Error ? error.message : "")) throw error;
  }
}

export async function shutdown(udid: string): Promise<void> {
  try {
    await simctl(["shutdown", assertUdid(udid)], 60_000);
  } catch (error) {
    if (!/current state: Shutdown/i.test(error instanceof Error ? error.message : "")) throw error;
  }
}

/** Bring the Simulator app forward on this device. The screen also works headless. */
export async function reveal(udid: string): Promise<void> {
  await run("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", assertUdid(udid)]);
}

export async function appearance(udid: string): Promise<"light" | "dark" | "unknown"> {
  const { stdout } = await simctl(["ui", assertUdid(udid), "appearance"]);
  const value = stdout.trim();
  return value === "light" || value === "dark" ? value : "unknown";
}

export async function setAppearance(udid: string, style: "light" | "dark"): Promise<void> {
  await simctl(["ui", assertUdid(udid), "appearance", style]);
}

/** Any URL with a scheme: deep links are the point, not only http(s). */
export function assertOpenableUrl(url: unknown): string {
  if (typeof url !== "string" || url.length > 2048) throw new Error("Enter a URL to open.");
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Enter a full URL, including its scheme.");
  }
  if (parsed.protocol === "file:" || parsed.protocol === "javascript:") throw new Error("That URL scheme cannot be opened on a simulator.");
  return parsed.href;
}

export async function openUrl(udid: string, url: string): Promise<void> {
  await simctl(["openurl", assertUdid(udid), assertOpenableUrl(url)]);
}

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

export function assertBundleId(bundleId: unknown): string {
  if (typeof bundleId !== "string" || !BUNDLE_ID.test(bundleId)) throw new Error("Choose an installed app.");
  return bundleId;
}

export async function launch(udid: string, bundleId: string): Promise<void> {
  await simctl(["launch", assertUdid(udid), assertBundleId(bundleId)], 30_000);
}

export async function terminate(udid: string, bundleId: string): Promise<void> {
  await simctl(["terminate", assertUdid(udid), assertBundleId(bundleId)]);
}

/**
 * One PNG of the main display. `simctl io screenshot -` writes a file called
 * `-` rather than to stdout, so the frame goes through a private temp file.
 */
export async function screenshot(udid: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "capsule-sim-"));
  const file = path.join(dir, "frame.png");
  try {
    await simctl(["io", assertUdid(udid), "screenshot", "--type=png", file], 10_000);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface SimctlSupport {
  supported: boolean;
  reason?: string;
}

/** Whether this machine can drive simulators at all. Nothing is installed to find out. */
export async function support(platform: NodeJS.Platform = process.platform): Promise<SimctlSupport> {
  if (platform !== "darwin") return { supported: false, reason: "The iOS Simulator needs macOS with Xcode installed." };
  try {
    await simctl(["help"], 10_000);
    return { supported: true };
  } catch {
    return {
      supported: false,
      reason: "Install Xcode and its iOS platform, then open Xcode once so its command-line tools are selected.",
    };
  }
}

// MARK: Device settings. Each is one `simctl` call; nothing here is private API.

export type ContentSize = "extra-small" | "small" | "medium" | "large" | "extra-large" | "extra-extra-large" | "extra-extra-extra-large" | "accessibility-medium" | "accessibility-large" | "accessibility-extra-large" | "accessibility-extra-extra-large" | "accessibility-extra-extra-extra-large";

export const CONTENT_SIZES: ContentSize[] = [
  "extra-small", "small", "medium", "large", "extra-large", "extra-extra-large", "extra-extra-extra-large",
  "accessibility-medium", "accessibility-large", "accessibility-extra-large", "accessibility-extra-extra-large", "accessibility-extra-extra-extra-large",
];

export async function contentSize(udid: string): Promise<string> {
  const { stdout } = await simctl(["ui", assertUdid(udid), "content_size"]);
  return stdout.trim();
}

export async function setContentSize(udid: string, size: "increment" | "decrement" | ContentSize): Promise<void> {
  if (size !== "increment" && size !== "decrement" && !CONTENT_SIZES.includes(size)) throw new Error("Unknown text size.");
  await simctl(["ui", assertUdid(udid), "content_size", size]);
}

export async function increaseContrast(udid: string): Promise<boolean | undefined> {
  const { stdout } = await simctl(["ui", assertUdid(udid), "increase_contrast"]);
  const value = stdout.trim();
  return value === "enabled" ? true : value === "disabled" ? false : undefined;
}

export async function setIncreaseContrast(udid: string, enabled: boolean): Promise<void> {
  await simctl(["ui", assertUdid(udid), "increase_contrast", enabled ? "enabled" : "disabled"]);
}

/** The App Store screenshot look: 9:41, full signal, full battery. */
export const CLEAN_STATUS_BAR = ["--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3", "--cellularMode", "active", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100"];

export async function setStatusBar(udid: string, mode: "clean" | "clear"): Promise<void> {
  const id = assertUdid(udid);
  if (mode === "clear") await simctl(["status_bar", id, "clear"]);
  else await simctl(["status_bar", id, "override", ...CLEAN_STATUS_BAR]);
}

export function assertCoordinate(value: unknown, name: "latitude" | "longitude"): number {
  const limit = name === "latitude" ? 90 : 180;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) throw new Error(`Enter a ${name} between -${limit} and ${limit}.`);
  return Math.round(value * 1e6) / 1e6;
}

export async function setLocation(udid: string, latitude: number, longitude: number): Promise<void> {
  await simctl(["location", assertUdid(udid), "set", `${assertCoordinate(latitude, "latitude")},${assertCoordinate(longitude, "longitude")}`]);
}

export async function clearLocation(udid: string): Promise<void> {
  await simctl(["location", assertUdid(udid), "clear"]);
}

/** The APNs payload `simctl push` reads from stdin. */
export function pushPayload(title: string, body: string): string {
  const trimmedTitle = title.trim().slice(0, 200);
  const trimmedBody = body.trim().slice(0, 1000);
  if (!trimmedTitle && !trimmedBody) throw new Error("A notification needs a title or a body.");
  return JSON.stringify({ aps: { alert: { ...(trimmedTitle ? { title: trimmedTitle } : {}), ...(trimmedBody ? { body: trimmedBody } : {}) }, sound: "default" } });
}

export async function push(udid: string, bundleId: string, title: string, body: string): Promise<void> {
  await run("xcrun", ["simctl", "push", assertUdid(udid), assertBundleId(bundleId), "-"], 15_000, pushPayload(title, body));
}

export const PRIVACY_SERVICES = ["all", "calendar", "contacts-limited", "contacts", "location", "location-always", "photos-add", "photos", "media-library", "microphone", "motion", "reminders", "siri"] as const;
export type PrivacyService = (typeof PRIVACY_SERVICES)[number];

export async function setPrivacy(udid: string, action: "grant" | "revoke" | "reset", service: string, bundleId?: string): Promise<void> {
  if (action !== "grant" && action !== "revoke" && action !== "reset") throw new Error("Unknown permission action.");
  if (!(PRIVACY_SERVICES as readonly string[]).includes(service)) throw new Error("Unknown permission service.");
  if (action !== "reset" && !bundleId) throw new Error("Choose an app to grant or revoke for.");
  await simctl(["privacy", assertUdid(udid), action, service, ...(bundleId ? [assertBundleId(bundleId)] : [])], 30_000);
}

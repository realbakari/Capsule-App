import { describe, expect, it } from "vitest";
import {
  assertBundleId,
  assertOpenableUrl,
  assertUdid,
  familyFor,
  parseAppList,
  parseDeviceList,
  runtimeLabel,
  support,
} from "./simctl.js";

// Shaped as `simctl list devices available -j` prints it.
const sample = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [
      { udid: "0D11CEBC-A627-49D6-8720-B562C71A0979", name: "iPhone 17 Pro", state: "Shutdown", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro", lastBootedAt: "2026-07-02T11:58:27Z" },
      { udid: "1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7", name: "iPhone 17 Pro Max", state: "Booted", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max", lastBootedAt: "2026-10-11T12:37:44Z" },
      { udid: "FC6AE426-C098-4A73-A254-DE331E3A0E25", name: "iPhone 17e", state: "Shutdown", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17e" },
      { udid: "9879671B-B6CF-41EC-B9FB-00BD3CC69DFE", name: "iPad Pro 13-inch (M5)", state: "Shutdown", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5", lastBootedAt: "2026-09-01T00:00:00Z" },
      { name: "no udid", state: "Shutdown" },
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-12-0": [
      { udid: "A1B2C3D4-0000-0000-0000-000000000001", name: "Apple Watch Ultra 3", state: "Shutdown", isAvailable: false, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3" },
    ],
  },
});

describe("runtimeLabel", () => {
  it("turns the runtime identifier into the name a person uses", () => {
    expect(runtimeLabel("com.apple.CoreSimulator.SimRuntime.iOS-26-4")).toBe("iOS 26.4");
    expect(runtimeLabel("com.apple.CoreSimulator.SimRuntime.watchOS-12-0")).toBe("watchOS 12.0");
    expect(runtimeLabel("com.apple.CoreSimulator.SimRuntime.xrOS-3-0")).toBe("xrOS 3.0");
  });

  it("leaves an unfamiliar key readable rather than empty", () => {
    expect(runtimeLabel("custom")).toBe("custom");
  });
});

describe("familyFor", () => {
  it("groups device types by product line", () => {
    expect(familyFor("com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro")).toBe("iPhone");
    expect(familyFor("com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M3")).toBe("iPad");
    expect(familyFor("com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3")).toBe("Apple Watch");
    expect(familyFor("com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation")).toBe("Apple TV");
    expect(familyFor("com.apple.CoreSimulator.SimDeviceType.Apple-Vision-Pro")).toBe("Apple Vision");
    expect(familyFor("")).toBe("Other");
  });
});

describe("parseDeviceList", () => {
  it("puts the booted device first, then the most recently used", () => {
    expect(parseDeviceList(sample).map((d) => d.name)).toEqual([
      "iPhone 17 Pro Max",
      "iPad Pro 13-inch (M5)",
      "iPhone 17 Pro",
      "iPhone 17e",
    ]);
  });

  it("carries runtime, family and state onto each device", () => {
    const booted = parseDeviceList(sample)[0];
    expect(booted).toMatchObject({ runtime: "iOS 26.4", family: "iPhone", state: "Booted", udid: "1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7" });
  });

  it("skips rows without a UDID and devices that are not available", () => {
    const names = parseDeviceList(sample).map((d) => d.name);
    expect(names).not.toContain("no udid");
    expect(names).not.toContain("Apple Watch Ultra 3");
  });

  it("fails loudly on output that is not a device list", () => {
    expect(() => parseDeviceList("not json")).toThrow(/could not be read/);
    expect(() => parseDeviceList("{}")).toThrow(/could not be read/);
  });
});

describe("parseAppList", () => {
  const apps = JSON.stringify({
    "com.apple.Passbook": { CFBundleDisplayName: "Wallet", CFBundleName: "Passbook", ApplicationType: "System" },
    "com.example.Zeta": { CFBundleName: "Zeta", ApplicationType: "User" },
    "com.example.Alpha": { CFBundleDisplayName: "Alpha", ApplicationType: "User" },
    "com.example.Bare": { ApplicationType: "User" },
  });

  it("lists user apps before system apps, alphabetically within each", () => {
    expect(parseAppList(apps).map((a) => a.name)).toEqual(["Alpha", "com.example.Bare", "Zeta", "Wallet"]);
  });

  it("prefers the display name and falls back to the bundle id", () => {
    const byId = Object.fromEntries(parseAppList(apps).map((a) => [a.bundleId, a]));
    expect(byId["com.apple.Passbook"]?.name).toBe("Wallet");
    expect(byId["com.example.Bare"]?.name).toBe("com.example.Bare");
    expect(byId["com.apple.Passbook"]?.type).toBe("System");
  });

  it("rejects output that is not an app dictionary", () => {
    expect(() => parseAppList("[]")).toThrow(/could not be read/);
  });
});

describe("argument guards", () => {
  it("accepts only a UDID, never the ambiguous booted alias", () => {
    expect(assertUdid("1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7")).toBe("1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7");
    expect(() => assertUdid("booted")).toThrow(/Choose a simulator/);
    expect(() => assertUdid("1F0BAB41; rm -rf /")).toThrow();
    expect(() => assertUdid(undefined)).toThrow();
  });

  it("opens deep links and web URLs but not local files", () => {
    expect(assertOpenableUrl("https://example.test/path")).toBe("https://example.test/path");
    expect(assertOpenableUrl("myapp://home")).toBe("myapp://home");
    expect(() => assertOpenableUrl("file:///etc/passwd")).toThrow(/cannot be opened/);
    expect(() => assertOpenableUrl("example.test")).toThrow(/scheme/);
    expect(() => assertOpenableUrl("")).toThrow();
  });

  it("accepts a bundle identifier and nothing shaped like a flag", () => {
    expect(assertBundleId("com.example.App")).toBe("com.example.App");
    expect(() => assertBundleId("--help")).toThrow();
    expect(() => assertBundleId("")).toThrow();
  });
});

describe("support", () => {
  it("says simulators need macOS before trying anything", async () => {
    await expect(support("linux")).resolves.toMatchObject({ supported: false, reason: expect.stringContaining("macOS") });
    await expect(support("win32")).resolves.toMatchObject({ supported: false });
  });
});

describe("device settings", () => {
  it("builds the APNs payload simctl push reads from stdin", async () => {
    const { pushPayload } = await import("./simctl.js");
    expect(JSON.parse(pushPayload("Hello", "World"))).toEqual({ aps: { alert: { title: "Hello", body: "World" }, sound: "default" } });
    expect(JSON.parse(pushPayload("", "Only a body"))).toEqual({ aps: { alert: { body: "Only a body" }, sound: "default" } });
    expect(() => pushPayload("  ", "")).toThrow(/title or a body/);
  });

  it("bounds coordinates to the globe", async () => {
    const { assertCoordinate } = await import("./simctl.js");
    expect(assertCoordinate(37.3348, "latitude")).toBe(37.3348);
    expect(assertCoordinate(-122.00902, "longitude")).toBe(-122.00902);
    expect(() => assertCoordinate(91, "latitude")).toThrow(/latitude/);
    expect(() => assertCoordinate(Number.NaN, "longitude")).toThrow(/longitude/);
  });

  it("describes the clean status bar once, as flags simctl accepts", async () => {
    const { CLEAN_STATUS_BAR } = await import("./simctl.js");
    expect(CLEAN_STATUS_BAR).toContain("--time");
    expect(CLEAN_STATUS_BAR[CLEAN_STATUS_BAR.indexOf("--time") + 1]).toBe("9:41");
    expect(CLEAN_STATUS_BAR.filter((flag) => flag.startsWith("--")).every((flag) => /^--[a-zA-Z]+$/.test(flag))).toBe(true);
  });
});

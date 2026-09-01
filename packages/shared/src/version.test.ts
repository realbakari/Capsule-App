import { describe, expect, it } from "vitest";
import { compareVersions, isNewerRelease, parseVersion } from "./version.js";

describe("parseVersion", () => {
  it("accepts the tag shapes this project produces", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("0.1")).toEqual({ major: 0, minor: 1, patch: 0, pre: [] });
    expect(parseVersion("1.2.3-beta.2")?.pre).toEqual(["beta", "2"]);
  });

  it("returns nothing for a tag it cannot read", () => {
    expect(parseVersion("nightly")).toBeUndefined();
    expect(parseVersion("release-2026-09-01")).toBeUndefined();
    expect(parseVersion("")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  const v = (value: string) => parseVersion(value)!;

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions(v("2.0.0"), v("1.9.9"))).toBe(1);
    expect(compareVersions(v("1.2.0"), v("1.10.0"))).toBe(-1); // not string order
    expect(compareVersions(v("1.2.3"), v("1.2.3"))).toBe(0);
  });

  it("ranks a final release above its own prerelease", () => {
    expect(compareVersions(v("1.2.0"), v("1.2.0-rc.1"))).toBe(1);
    expect(compareVersions(v("1.2.0-rc.1"), v("1.2.0"))).toBe(-1);
  });

  it("orders prerelease identifiers numerically where they are numbers", () => {
    expect(compareVersions(v("1.0.0-rc.2"), v("1.0.0-rc.10"))).toBe(-1);
    expect(compareVersions(v("1.0.0-alpha"), v("1.0.0-beta"))).toBe(-1);
  });

  it("treats a longer prerelease as later when the prefix matches", () => {
    expect(compareVersions(v("1.0.0-rc.1.1"), v("1.0.0-rc.1"))).toBe(1);
  });
});

describe("isNewerRelease", () => {
  it("offers a genuinely newer release", () => {
    expect(isNewerRelease("v0.2.0", "0.1.0")).toBe(true);
  });

  it("does not offer the version already running, or an older one", () => {
    expect(isNewerRelease("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerRelease("v0.0.9", "0.1.0")).toBe(false);
  });

  it("says no when either side cannot be read, rather than guessing", () => {
    // Sending someone to a download page for an update that is not there is
    // worse than saying nothing.
    expect(isNewerRelease("nightly", "0.1.0")).toBe(false);
    expect(isNewerRelease("v0.2.0", "unknown")).toBe(false);
  });
});

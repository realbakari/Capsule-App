import { describe, expect, it } from "vitest";
import { isNewerRelease, pickReleaseAsset } from "./version.js";

describe("against the published v0.1.0 release", () => {
  // The real asset list from realbakari/Capsule-App v0.1.0.
  const assets = [
    { name: "Capsule-0.1.0-arm64.dmg", browser_download_url: "https://x/Capsule-0.1.0-arm64.dmg", size: 1 },
    { name: "Capsule-0.1.0-arm64.zip", browser_download_url: "https://x/Capsule-0.1.0-arm64.zip", size: 1 },
    { name: "SHA256SUMS.txt", browser_download_url: "https://x/SHA256SUMS.txt", size: 1 },
  ];

  it("offers the arm64 installer to an Apple Silicon Mac", () => {
    expect(pickReleaseAsset(assets, "arm64")?.name).toBe("Capsule-0.1.0-arm64.dmg");
  });

  it("offers an Intel Mac nothing rather than a build it cannot run", () => {
    expect(pickReleaseAsset(assets, "x64")).toBeUndefined();
  });

  it("does not offer v0.1.0 to someone already running it", () => {
    expect(isNewerRelease("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerRelease("v0.1.1", "0.1.0")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { externalLinkTarget, isAppDocument } from "./app-navigation";

describe("isAppDocument", () => {
  const packaged = "file:///Applications/Capsule.app/Contents/Resources/app/out/renderer/index.html";

  it("keeps the packaged renderer, with or without a hash", () => {
    expect(isAppDocument(packaged, packaged)).toBe(true);
    expect(isAppDocument(`${packaged}#/settings`, packaged)).toBe(true);
  });

  it("refuses any other file, such as one dropped on the window", () => {
    expect(isAppDocument("file:///Users/me/Downloads/report.html", packaged)).toBe(false);
    expect(isAppDocument("file:///Users/me/Pictures/shot.png", packaged)).toBe(false);
  });

  it("keeps the dev server's own origin and refuses others", () => {
    const dev = "http://localhost:5173/";
    expect(isAppDocument("http://localhost:5173/index.html", dev)).toBe(true);
    expect(isAppDocument("http://localhost:5174/", dev)).toBe(false);
    expect(isAppDocument("https://example.com/", dev)).toBe(false);
  });

  it("refuses what it cannot parse", () => {
    expect(isAppDocument("not a url", packaged)).toBe(false);
  });
});

describe("externalLinkTarget", () => {
  it("passes web and mail links to the OS", () => {
    expect(externalLinkTarget("https://example.com/a")).toBe("https://example.com/a");
    expect(externalLinkTarget("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  it("drops schemes that launch or read local things", () => {
    expect(externalLinkTarget("file:///Applications/Calculator.app")).toBeUndefined();
    expect(externalLinkTarget("javascript:alert(1)")).toBeUndefined();
    expect(externalLinkTarget("x-apple.systempreferences:com.apple.preference")).toBeUndefined();
    expect(externalLinkTarget("garbage")).toBeUndefined();
  });
});

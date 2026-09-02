import { describe, expect, it } from "vitest";
import { mergeBrowserRecent, normalizedBrowserUrl, parseBrowserRecents } from "./EmbeddedBrowser";

describe("normalizedBrowserUrl", () => {
  it("adds HTTP to local addresses", () => {
    expect(normalizedBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
  });

  it("keeps HTTP and HTTPS URLs", () => {
    expect(normalizedBrowserUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("rejects non-web protocols and invalid addresses", () => {
    expect(normalizedBrowserUrl("javascript:alert(1)")).toBe("");
    expect(normalizedBrowserUrl("file:///tmp/index.html")).toBe("");
    expect(normalizedBrowserUrl("http://[invalid")).toBe("");
  });
});

describe("browser recents", () => {
  it("ignores malformed storage", () => {
    expect(parseBrowserRecents("not json")).toEqual([]);
    expect(parseBrowserRecents('{"url":"https://example.com"}')).toEqual([]);
  });

  it("moves a revisited URL to the front without duplicating it", () => {
    const first = { url: "http://localhost:3000/", title: "First", lastUsedAt: "2026-01-01T00:00:00.000Z" };
    const second = { url: "http://localhost:5173/", title: "Second", lastUsedAt: "2026-01-02T00:00:00.000Z" };
    const revisited = { ...first, title: "Updated", lastUsedAt: "2026-01-03T00:00:00.000Z" };
    expect(mergeBrowserRecent([second, first], revisited)).toEqual([revisited, second]);
  });
});

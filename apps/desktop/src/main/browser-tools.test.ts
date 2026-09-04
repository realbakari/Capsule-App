import { describe, expect, it } from "vitest";

import {
  browserNavigate,
  browserSnapshot,
  browserStatus,
  noBrowser,
  readNavigableUrl,
  type BrowserTarget,
} from "./browser-tools";

const noPage: BrowserTarget = { contents: () => undefined };

function page(overrides: Record<string, unknown> = {}): BrowserTarget {
  const contents = {
    getURL: () => "https://example.com/a",
    getTitle: () => "Example",
    isLoading: () => false,
    loadURL: async () => undefined,
    executeJavaScript: async () => ({
      url: "https://example.com/a",
      title: "Example",
      text: "Hello",
      elements: [{ ref: 1, tag: "a", label: "Next" }],
    }),
    ...overrides,
  };
  return { contents: () => contents as never };
}

describe("what an agent may open", () => {
  it("refuses a file URL", () => {
    /*
     * A tool that opens whatever URL the model produces is a way to read the
     * disk — and the string may itself have come off a web page.
     */
    expect(readNavigableUrl("file:///Users/someone/.ssh/id_rsa").url).toBeUndefined();
    expect(readNavigableUrl("file:///etc/passwd").detail).toMatch(/http and https only/i);
  });

  it("refuses schemes that are not the web", () => {
    for (const url of ["capsule://open", "javascript:alert(1)", "data:text/html,<b>x"]) {
      expect(readNavigableUrl(url).url).toBeUndefined();
    }
  });

  it("accepts ordinary web addresses", () => {
    expect(readNavigableUrl("https://example.com").url).toBe("https://example.com/");
    expect(readNavigableUrl("http://localhost:3000/x").url).toBe("http://localhost:3000/x");
  });

  it("says what to pass when given nothing usable", () => {
    expect(readNavigableUrl("").detail).toMatch(/example\.com/);
    expect(readNavigableUrl("not a url").detail).toMatch(/scheme/i);
    expect(readNavigableUrl(42).detail).toMatch(/Pass a url/);
  });
});

describe("with no page open", () => {
  it("says so, and says what to do about it", async () => {
    // "false" teaches an agent nothing; this tells it which call comes first.
    for (const result of [await browserStatus(noPage), await browserSnapshot(noPage)]) {
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/browser_navigate/);
    }
    expect(noBrowser().detail).toMatch(/No browser page is open/);
  });

  it("still refuses a bad URL before complaining about the missing page", async () => {
    // The URL is wrong whether or not a page is open, and saying so is more
    // useful than "open a browser first" for a call that would never work.
    const result = await browserNavigate(noPage, "file:///etc/passwd");
    expect(result.detail).toMatch(/http and https only/i);
  });
});

describe("reading the page", () => {
  it("reports what is on screen", async () => {
    const result = await browserStatus(page());
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("https://example.com/a");
  });

  it("returns text and the things that can be clicked", async () => {
    const result = await browserSnapshot(page());
    expect(result.ok).toBe(true);
    expect((result.data as { elements: unknown[] }).elements).toHaveLength(1);
    expect(result.detail).toMatch(/1 interactive elements/);
  });

  it("hands back a page that refused to answer, rather than hanging the turn", async () => {
    const result = await browserSnapshot(
      page({ executeJavaScript: async () => { throw new Error("detached"); } }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/detached/);
  });

  it("treats a failed load as the page's answer, not a broken tool", async () => {
    const result = await browserNavigate(
      page({ loadURL: async () => { throw new Error("ERR_CONNECTION_REFUSED"); } }),
      "https://example.com",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ERR_CONNECTION_REFUSED/);
  });
});

import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  browserNavigate,
  browserSnapshot,
  boundedBrowserSnapshot,
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
  it("opens the desktop guest before navigating instead of a recovery loop", async () => {
    const loadURL = vi.fn();
    const target = page({ loadURL, getURL: () => "https://example.com/redirected" });
    const open = vi.fn(async () => target.contents());
    const result = await browserNavigate({ contents: () => undefined, open }, "https://example.com/a");
    expect(open).toHaveBeenCalledWith("https://example.com/a");
    expect(result.ok).toBe(true);
    expect(loadURL).not.toHaveBeenCalled();
    expect(result.data).toEqual({ url: "https://example.com/redirected" });
    await browserNavigate({ contents: () => undefined, open }, "file:///private.txt");
    expect(open).toHaveBeenCalledTimes(1);
    const failed = await browserNavigate({ contents: () => undefined, open: async () => { throw new Error("Panel not ready"); } }, "https://example.com");
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain("Panel not ready");
  });
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
  it("bounds page text before crossing IPC and never includes password field values", async () => {
    const result = await browserSnapshot(page({ executeJavaScript: async (script: string) => runInNewContext(script, {
      location: { href: "https://example.com" },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      document: { title: "Fixture", body: { innerText: "x".repeat(50_000) }, querySelectorAll: () => [{
        tagName: "INPUT", type: "password", value: "never leak this value", getAttribute: () => "", getBoundingClientRect: () => ({ width: 100, height: 20 }),
      }] },
    }) }));
    expect(JSON.stringify(result)).not.toContain("never leak this value");
    expect((result.data as { text: string }).text.length).toBeLessThan(20_100);
    expect((result.data as { truncated: boolean }).truncated).toBe(true);
  });
  it("bounds long links, titles and aggregate multibyte content", async () => {
    const huge = "界".repeat(700_000);
    const result = await browserSnapshot(page({ executeJavaScript: async (script: string) => runInNewContext(script, {
      location: { href: huge }, getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      document: { title: huge, body: { innerText: "hello" }, querySelectorAll: () => [{
        tagName: "A", innerText: "Download", getAttribute: (name: string) => name === "href" ? huge : "",
        getBoundingClientRect: () => ({ width: 10, height: 10 }),
      }] },
    }) }));
    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(96_000);
    expect(result.data).toMatchObject({ truncated: true });
    const bounded = boundedBrowserSnapshot({ title: huge, url: huge, text: huge, elements: Array.from({ length: 400 }, () => ({ href: huge, label: huge })) });
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(96_000);
    expect(bounded.truncated).toBe(true);
  });
  it("clears its watchdog when the page has answered", async () => {
    vi.useFakeTimers();
    try { await browserSnapshot(page()); expect(vi.getTimerCount()).toBe(0); }
    finally { vi.useRealTimers(); }
  });
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

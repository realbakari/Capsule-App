import { describe, expect, it } from "vitest";
import { BrowserAccess } from "./browser-access";
import { browserScreenshot } from "./browser-tools";

describe("browser ownership", () => {
  it.each(["regrant", "background", "replacement"])("rejects captured pixels after %s changes the original grant", async (change) => {
    let finish!: (image: never) => void;
    let foreground = { capturePage: () => new Promise((resolve) => { finish = resolve; }) } as never;
    let background: never | undefined;
    const access = new BrowserAccess({ contents: () => foreground }, () => background ? { contents: () => background } : undefined);
    access.select("thread"); access.allow("thread", true);
    const capture = browserScreenshot(access.target("thread"));
    if (change === "replacement") foreground = {} as never;
    else {
      access.revoke("thread");
      if (change === "regrant") access.allow("thread", true);
      else background = {} as never;
    }
    finish({} as never);
    await expect(capture).rejects.toThrow(/changed/);
  });
  it("keeps a separately granted background page reachable across thread selection without falling back", () => {
    const foreground = {} as never;
    const background = {} as never;
    let allowed = true;
    let exists = true;
    const access = new BrowserAccess({ contents: () => foreground }, (owner, harness) => owner === "first" && exists
      ? { check: () => { if (!allowed || harness !== "agent") throw new Error("Revoked"); }, contents: () => background } : undefined);
    access.select("second"); access.allow("second", true);
    const target = access.target("first", "agent");
    expect(target.contents()).toBe(background);
    expect(() => access.target("first", "other").contents()).toThrow("Revoked");
    allowed = false;
    expect(() => target.contents()).toThrow("Revoked");
    exists = false;
    expect(() => target.contents()).toThrow("Browser access is off");
  });
  it("requires a visible-thread grant and revokes it across selection changes", () => {
    const page = {} as never;
    const access = new BrowserAccess({ contents: () => page });
    const first = access.target("first");
    const second = access.target("second");
    access.select("first");
    expect(() => first.contents()).toThrow("Allow agent control");
    access.allow("first", true);
    expect(first.contents()).toBe(page);
    expect(() => second.contents()).toThrow();
    access.select("second");
    expect(() => first.contents()).toThrow();
    expect(() => second.contents()).toThrow();
    expect(() => access.allow("first", true)).toThrow();
    access.select("first");
    expect(() => first.contents()).toThrow();
  });
  it("rechecks ownership after opening a guest", async () => {
    let ready!: (page: never) => void;
    const access = new BrowserAccess({ contents: () => undefined, open: () => new Promise((resolve) => { ready = resolve; }) });
    access.select("first"); access.allow("first", true);
    const opening = access.target("first").open!("https://example.test");
    access.select("second"); ready({} as never);
    await expect(opening).rejects.toThrow("Browser access is off");
  });
});

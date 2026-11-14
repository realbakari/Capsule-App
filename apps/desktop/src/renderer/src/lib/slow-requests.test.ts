import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLabel, withSlowNotice } from "./slow-requests";

afterEach(() => { vi.useRealTimers(); });

describe("slow request notices", () => {
  it("says a call is slow after the delay and clears when it settles", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const events: Array<[string, boolean]> = [];
    const api = withSlowNotice({ gitPush: () => new Promise<void>((resolve) => { finish = resolve; }), pickFiles: () => new Promise(() => undefined) },
      (name, waiting) => events.push([name, waiting]), 100);
    const push = api.gitPush();
    void api.pickFiles();
    await vi.advanceTimersByTimeAsync(150);
    expect(events).toEqual([["gitPush", true]]);
    finish(); await push; await Promise.resolve();
    expect(events).toEqual([["gitPush", true], ["gitPush", false]]);
  });

  it("stays quiet for fast calls and keeps plain values and getters", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const api = withSlowNotice({ isDesktop: true, get mode() { return "read"; }, quick: async () => 1 }, () => events.push(1), 100);
    expect(await api.quick()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual([]);
    expect(api.isDesktop).toBe(true);
    expect(api.mode).toBe("read");
  });

  it("names the request in words", () => {
    expect(requestLabel("gitCreatePullRequest")).toBe("git create pull request");
  });
});

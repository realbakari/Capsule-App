import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLabel, withSlowNotice } from "./slow-requests";

afterEach(() => { vi.useRealTimers(); });

describe("slow request notices", () => {
  it("says a call the person made is slow, never a background status read, and clears when it settles", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const events: Array<[string, boolean]> = [];
    const api = withSlowNotice({
      gitPush: () => new Promise<void>((resolve) => { finish = resolve; }),
      pickFiles: () => new Promise(() => undefined),
      gitStatus: () => new Promise(() => undefined),
    }, (name, waiting) => events.push([name, waiting]), 100);
    const push = api.gitPush();
    void api.pickFiles();
    void api.gitStatus();
    await vi.advanceTimersByTimeAsync(150);
    expect(events).toEqual([["gitPush", true]]);
    finish(); await push; await Promise.resolve();
    expect(events).toEqual([["gitPush", true], ["gitPush", false]]);
  });

  it("calls a method replaced on the bridge after an earlier call", async () => {
    const bridge = { quick: async () => "first" };
    const api = withSlowNotice(bridge, () => undefined, 100);
    expect(await api.quick()).toBe("first");
    bridge.quick = async () => "second";
    expect(await api.quick()).toBe("second");
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

  it("names what the person is waiting on, never the bridge method", () => {
    expect(requestLabel("steerHarness")).toBe("the agent");
    expect(requestLabel("sendMessage")).toBe("the agent");
    expect(requestLabel("listRunEventPage")).toBe("the conversation");
    expect(requestLabel("listMessagePage")).toBe("the conversation");
    expect(requestLabel("gitStatus")).toBe("Git");
    expect(requestLabel("turnDiff")).toBe("Git");
    expect(requestLabel("gitCreatePullRequest")).toBe("Git");
    expect(requestLabel("listPullRequests")).toBe("GitHub");
    expect(requestLabel("frobnicate")).toBe("Capsule");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  channelIsUnread,
  markChannelRead,
  markChannelUnread,
  parseChannelPrefs,
  recordChannelActivity,
  shouldGroupChannelPosts,
  toggleMuted,
  toggleStarred,
  unreadChannelCount,
  loadChannelPrefs,
  setActiveChannelScope,
} from "./channel-prefs";
afterEach(() => { setActiveChannelScope(undefined); vi.unstubAllGlobals(); });

describe("channel prefs", () => {
  it("isolates identities and relays without adopting unidentified legacy preferences", () => {
    const storage = new Map<string, string>([["capsule.channelPrefs", JSON.stringify({ muted: ["shared"] })]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    expect(loadChannelPrefs("relay:alice").muted).toEqual([]);
    toggleMuted(loadChannelPrefs("relay:alice"), "shared");
    expect(loadChannelPrefs("relay:alice").muted).toEqual(["shared"]);
    expect(loadChannelPrefs("relay:bob").muted).toEqual([]);
    expect(loadChannelPrefs("other:alice").muted).toEqual([]);
    setActiveChannelScope("relay:alice");
    expect(loadChannelPrefs().muted).toEqual(["shared"]);
    expect(loadChannelPrefs(null).muted).toEqual([]);
    setActiveChannelScope(undefined);
    expect(unreadChannelCount(loadChannelPrefs())).toBe(0);
  });
  it("parses stored stars, mutes, and read markers", () => {
    const prefs = parseChannelPrefs({
      starred: ["a", "a", ""],
      muted: ["b"],
      lastRead: { a: 10 },
      lastActivity: { a: 12, b: 9 },
      threadWidth: 900,
    });
    expect(prefs.starred).toEqual(["a"]);
    expect(prefs.muted).toEqual(["b"]);
    expect(prefs.threadWidth).toBe(640);
    expect(channelIsUnread(prefs, "a")).toBe(true);
    expect(channelIsUnread(prefs, "b")).toBe(false);
    expect(unreadChannelCount(prefs)).toBe(1);
  });

  it("toggles star and mute without duplicating ids", () => {
    let prefs = parseChannelPrefs({});
    prefs = toggleStarred(prefs, "eng");
    prefs = toggleStarred(prefs, "eng");
    prefs = toggleMuted(prefs, "eng");
    expect(prefs.starred).toEqual([]);
    expect(prefs.muted).toEqual(["eng"]);
  });

  it("marks a channel unread just behind the latest activity", () => {
    let prefs = parseChannelPrefs({});
    prefs = recordChannelActivity(prefs, "eng", 40);
    prefs = markChannelRead(prefs, "eng", 40);
    expect(channelIsUnread(prefs, "eng")).toBe(false);
    prefs = markChannelUnread(prefs, "eng");
    expect(channelIsUnread(prefs, "eng")).toBe(true);
  });

  it("groups consecutive posts from the same author within seven minutes", () => {
    expect(shouldGroupChannelPosts({ author: "a", createdAt: 100 }, { author: "a", createdAt: 400 })).toBe(true);
    expect(shouldGroupChannelPosts({ author: "a", createdAt: 100 }, { author: "b", createdAt: 120 })).toBe(false);
    expect(shouldGroupChannelPosts({ author: "a", createdAt: 100 }, { author: "a", createdAt: 100 + 7 * 60 })).toBe(false);
  });
});

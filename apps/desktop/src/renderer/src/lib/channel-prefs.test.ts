import { describe, expect, it } from "vitest";
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
} from "./channel-prefs";

describe("channel prefs", () => {
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

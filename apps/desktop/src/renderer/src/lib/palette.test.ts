import { describe, expect, it } from "vitest";
import { highlightRuns, rankPalette, type PaletteEntry } from "./palette";

const entry = (id: string, label: string, group: string, extra: Partial<PaletteEntry> = {}): PaletteEntry =>
  ({ id, label, group, run: () => undefined, ...extra });

const entries = [
  entry("recent-1", "Fix login redirect", "Conversations"),
  entry("recent-2", "Draft release notes", "Conversations"),
  entry("recent-3", "Theme audit", "Conversations"),
  entry("new", "New conversation", "Actions"),
  entry("settings", "Settings", "Go to"),
  entry("dark", "Dark theme", "Theme", { keywords: "appearance colour mode" }),
  entry("light", "Light theme", "Theme", { keywords: "appearance colour mode" }),
  entry("project-web", "web-client", "Projects", { searchOnly: true }),
];
const ids = (ranked: Array<{ id: string }>) => ranked.map((item) => item.id);

describe("rankPalette", () => {
  it("keeps the given order with no query, hides search-only rows and caps groups", () => {
    expect(ids(rankPalette(entries, "  ", { limits: { Conversations: 2 } }))).toEqual(["recent-1", "recent-2", "new", "settings", "dark", "light"]);
  });

  it("lists each group once with no query, where its first entry was given", () => {
    const mixed = [entry("a1", "New conversation", "Actions"), entry("w1", "Show terminal", "Workspace"), entry("a2", "Open folder", "Actions"), entry("w2", "Open browser", "Workspace")];
    expect(ids(rankPalette(mixed, ""))).toEqual(["a1", "a2", "w1", "w2"]);
  });

  it("hides what cannot run with no query, and shows it with the reason once typed", () => {
    const fork = entry("fork", "Fork conversation from last turn", "Actions", { disabledReason: "Open a conversation first." });
    expect(ids(rankPalette([...entries, fork], ""))).not.toContain("fork");
    expect(rankPalette([...entries, fork], "fork")[0]).toMatchObject({ id: "fork", disabledReason: "Open a conversation first." });
  });

  it("ranks a command above a thread that matches as well", () => {
    const tie = [entry("thread", "New login page", "Conversations"), entry("new", "New conversation in Example", "Actions")];
    expect(ids(rankPalette(tie, "new", { content: ["Conversations"] }))).toEqual(["new", "thread"]);
    expect(ids(rankPalette(tie, "new login", { content: ["Conversations"] }))[0]).toBe("thread");
  });

  it("puts the group holding the best match first", () => {
    const ranked = rankPalette(entries, "theme");
    expect(ids(ranked)).toEqual(["recent-3", "dark", "light"]);
  });

  it("lets the group with the tighter best match lead when scores tie", () => {
    expect(ids(rankPalette([entry("t", "New conversation flow", "Conversations"), entry("n", "New conversation", "Actions")], "nc"))).toEqual(["n", "t"]);
  });

  it("reaches an entry through its keywords, below label matches, without highlighting", () => {
    const ranked = rankPalette(entries, "appearance");
    expect(ids(ranked)).toEqual(["dark", "light"]);
    expect(ranked[0]!.matches).toEqual([]);
  });

  it("shows search-only rows once the person types", () => {
    expect(ids(rankPalette(entries, "web"))).toContain("project-web");
  });

  it("caps a group after ranking, so the best rows survive", () => {
    const threads = ["Alpha", "Beta notes", "Notes"].map((label, index) => entry(`t${index}`, label, "Conversations"));
    expect(ids(rankPalette(threads, "notes", { limits: { Conversations: 1 } }))).toEqual(["t2"]);
  });

  it("matches each query word on its own, in any order, label or keyword", () => {
    const threads = [entry("t", "Fix login redirect", "Conversations", { keywords: "web-client" }), entry("u", "Login copy", "Conversations", { keywords: "docs" })];
    expect(ids(rankPalette(threads, "redirect fix"))).toEqual(["t"]);
    expect(ids(rankPalette(threads, "login client"))).toEqual(["t"]);
    expect(rankPalette(threads, "redirect fix")[0]!.matches).toEqual([0, 1, 2, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("breaks a tie with the more recent thread, and lifts recent ones a little", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    const day = 86_400_000;
    const older = entry("older", "Release notes", "Conversations", { recency: now - 30 * day });
    const newer = entry("newer", "Release notes draft", "Conversations", { recency: now - 1000 });
    expect(ids(rankPalette([older, newer], "release", { now }))).toEqual(["newer", "older"]);
    const exact = entry("exact", "Theme audit", "Conversations", { recency: now - 60 * day });
    const scattered = entry("scattered", "The mobile export", "Conversations", { recency: now });
    expect(ids(rankPalette([scattered, exact], "theme", { now }))[0]).toBe("exact");
  });

  it("forgives a typo only when nothing matches as typed", () => {
    expect(ids(rankPalette(entries, "setings"))).toEqual(["settings"]);
    expect(ids(rankPalette(entries, "drak theme"))).toEqual(["dark"]);
    expect(ids(rankPalette([...entries, entry("set", "Set up Capsule", "Actions")], "setup"))).toEqual(["set"]);
    expect(rankPalette(entries, "zzzz")).toEqual([]);
  });

  it("stays fast across hundreds of rows, typo pass included", () => {
    const many = Array.from({ length: 1500 }, (_, index) => entry(`t${index}`, `Investigate flaky checkout test ${index} in the payments service`, "Conversations", { keywords: "project-name", recency: index }));
    const started = performance.now();
    rankPalette(many, "payments checkout");
    rankPalette(many, "paymnets chekout");
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("returns the matched label positions", () => {
    expect(rankPalette(entries, "nc")[0]).toMatchObject({ id: "new", matches: [0, 4] });
  });
});

describe("highlightRuns", () => {
  it("splits a label into matched and plain runs", () => {
    expect(highlightRuns("New conversation", [0, 4, 5])).toEqual([
      { text: "N", match: true }, { text: "ew ", match: false }, { text: "co", match: true }, { text: "nversation", match: false },
    ]);
    expect(highlightRuns("Plain", [])).toEqual([{ text: "Plain", match: false }]);
  });
});

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
    expect(ids(rankPalette(entries, "  ", { Conversations: 2 }))).toEqual(["recent-1", "recent-2", "new", "settings", "dark", "light"]);
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
    expect(ids(rankPalette(threads, "notes", { Conversations: 1 }))).toEqual(["t2"]);
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

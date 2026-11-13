import { describe, expect, it } from "vitest";
import { fuzzyScore, rankFuzzy } from "./fuzzy.js";

const labels = (items: Array<{ item: string }>) => items.map((entry) => entry.item);

describe("fuzzyScore", () => {
  it("matches a subsequence in order and rejects anything else", () => {
    expect(fuzzyScore("ncv", "New conversation")).toBeDefined();
    expect(fuzzyScore("vcn", "New conversation")).toBeUndefined();
    expect(fuzzyScore("xyz", "New conversation")).toBeUndefined();
    expect(fuzzyScore("a much longer query", "short")).toBeUndefined();
  });

  it("ignores case and whitespace in the query", () => {
    expect(fuzzyScore("NEW CONV", "New conversation")?.positions).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  it("highlights word starts rather than the leftmost letters", () => {
    expect(fuzzyScore("nc", "New conversation")?.positions).toEqual([0, 4]);
    expect(fuzzyScore("gtf", "Go to file")?.positions).toEqual([0, 3, 6]);
    expect(fuzzyScore("ct", "Copy path to clipboard")?.positions).toEqual([0, 10]);
  });

  it("treats camelCase and path separators as word starts", () => {
    expect(fuzzyScore("ts", "threadState.ts")?.positions).toEqual([0, 6]);
    expect(fuzzyScore("rv", "src/review/view.tsx")?.positions).toEqual([4, 11]);
  });

  it("an empty query matches everything with no highlight", () => {
    expect(fuzzyScore("  ", "Anything")).toEqual({ score: 0, positions: [] });
  });
});

describe("rankFuzzy", () => {
  it("puts word-start and consecutive matches ahead of scattered ones", () => {
    const ranked = rankFuzzy(["Toggle terminal", "Dark theme", "Open the thread menu"], "the", (item) => item);
    expect(labels(ranked)[0]).toBe("Dark theme");
    expect(labels(rankFuzzy(["Restart agent session", "Reveal settings", "Rename"], "rs", (item) => item))[0]).not.toBe("Rename");
  });

  it("prefers a prefix over the same letters later in the text", () => {
    expect(labels(rankFuzzy(["Open settings", "Settings"], "set", (item) => item))).toEqual(["Settings", "Open settings"]);
  });

  it("breaks ties with the shorter text, then the input order", () => {
    expect(labels(rankFuzzy(["Pin conversation", "Pin"], "pin", (item) => item))).toEqual(["Pin", "Pin conversation"]);
    expect(labels(rankFuzzy(["Fix login b", "Fix login a"], "fix", (item) => item))).toEqual(["Fix login b", "Fix login a"]);
  });

  it("drops items that do not match", () => {
    expect(labels(rankFuzzy(["Light theme", "Dark theme", "Archive"], "theme", (item) => item))).toEqual(["Dark theme", "Light theme"]);
  });

  it("stays fast across hundreds of long titles", () => {
    const titles = Array.from({ length: 2000 }, (_, index) => `Investigate flaky checkout test number ${index} in the payments service retry path`);
    const started = performance.now();
    rankFuzzy(titles, "payments retry", (item) => item);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

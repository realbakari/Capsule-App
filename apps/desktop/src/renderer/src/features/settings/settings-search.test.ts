import { describe, expect, it } from "vitest";
import {
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  searchSettings,
} from "./settings-search.js";

describe("searchSettings", () => {
  it("waits for two characters rather than listing everything", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("t")).toEqual([]);
    expect(searchSettings("th").length).toBeGreaterThan(0);
  });

  it("ranks a title match above a keyword match", () => {
    const results = searchSettings("font");
    expect(results[0]?.title).toContain("font");
  });

  it("ranks an exact title first", () => {
    expect(searchSettings("Theme")[0]?.title).toBe("Theme");
  });

  it("finds a setting by a word that is not in its title", () => {
    // Someone looking for "dark" will not type "Theme".
    expect(searchSettings("dark").map((r) => r.title)).toContain("Theme");
    expect(searchSettings("squash").map((r) => r.title)).toContain("Merge method");
  });

  it("is case insensitive", () => {
    expect(searchSettings("GATEWAY").length).toBeGreaterThan(0);
  });

  it("carries the section label so a result says where it lives", () => {
    const result = searchSettings("branch prefix")[0];
    expect(result?.section).toBe("sourceControl");
    expect(result?.sectionLabel).toBe("Source control");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchSettings("zzzznotasetting")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchSettings("e", 3).length).toBeLessThanOrEqual(3);
    expect(searchSettings("se", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("the catalog itself", () => {
  it("points every item at a real section", () => {
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(SETTINGS_SECTION_LABELS[item.section], item.title).toBeDefined();
    }
  });

  it("has no duplicate title within a section", () => {
    const seen = new Set<string>();
    for (const item of SETTINGS_SEARCH_ITEMS) {
      const key = `${item.section}:${item.title}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

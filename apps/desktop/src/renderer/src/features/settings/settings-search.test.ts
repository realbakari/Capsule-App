import { readFileSync } from "node:fs";
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
    // The row is called "Pull request merge method" in the panel; the point
    // is that "squash" finds it without typing any of those words.
    expect(searchSettings("squash").map((r) => r.title)).toContain(
      "Pull request merge method",
    );
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

describe("the catalog against the panels", () => {
  /*
   * The catalog is only useful if a result leads somewhere. Written from
   * memory rather than from the panels, twelve of its thirty-nine titles named
   * rows that do not exist — searching "Web access" jumped to a section whose
   * row is called "Web search" — so the result looked broken rather than
   * helpful. This reads the panels so that cannot happen again.
   */
  const panelSource = [
    "SettingsView.tsx",
    "ConfigurationSettings.tsx",
    "AppearanceSettings.tsx",
    "KeybindingsSettings.tsx",
    "SourceControlTools.tsx",
    "ProcessMonitor.tsx",
  ]
    .map((name) => {
      const path = new URL(`./${name}`, import.meta.url);
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  it("reads the panel sources", () => {
    expect(panelSource.length).toBeGreaterThan(1000);
  });

  it("names a row that actually exists for every searchable setting", () => {
    const missing = SETTINGS_SEARCH_ITEMS.filter((item) => !panelSource.includes(item.title));
    expect(missing.map((item) => `${item.section}: ${item.title}`)).toEqual([]);
  });
});

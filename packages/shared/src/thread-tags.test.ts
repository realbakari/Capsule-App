import { describe, expect, it } from "vitest";
import { searchSessionTitles } from "./session-search.js";
import { collectTags, groupThreadsByTag, normalizeTag, normalizeTags, parseThreadQuery, renameTagIn } from "./thread-tags.js";
import type { Session } from "./types.js";

const thread = (id: string, title: string, tags?: string[], updatedAt = "2026-01-01T00:00:00.000Z") =>
  ({ id, title, tags, updatedAt, projectId: "p" }) as Session;

describe("tags", () => {
  it("stores one spelling per tag", () => {
    expect(normalizeTag("  #Bug Fix ")).toBe("bug-fix");
    expect(normalizeTag("###")).toBeUndefined();
    expect(normalizeTag("front/end")).toBe("front/end");
    expect(normalizeTags(["UI", "ui", " #ui", "backend"])).toEqual(["backend", "ui"]);
  });

  it("reads tag filters out of a search", () => {
    expect(parseThreadQuery("login #Bug tag:ui")).toEqual({ text: "login", tags: ["bug", "ui"] });
    expect(parseThreadQuery("C# notes")).toEqual({ text: "c# notes", tags: [] });
  });

  it("narrows title search to threads with every tag", () => {
    const sessions = [thread("a", "Fix login", ["bug"]), thread("b", "Login page", ["ui"]), thread("c", "Fix sidebar", ["bug", "ui"])];
    expect(searchSessionTitles(sessions, "#bug").map((item) => item.id).sort()).toEqual(["a", "c"]);
    expect(searchSessionTitles(sessions, "fix #ui").map((item) => item.id)).toEqual(["c"]);
    expect(searchSessionTitles(sessions, "login").map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("groups by tag across projects, untagged last, a thread under each of its tags", () => {
    const groups = groupThreadsByTag([thread("a", "A", ["ui", "bug"]), thread("b", "B"), thread("c", "C", ["bug"])]);
    expect(groups.map((group) => [group.tag, group.threads.map((item) => item.id)])).toEqual([
      ["bug", ["a", "c"]],
      ["ui", ["a"]],
      [undefined, ["b"]],
    ]);
    expect(collectTags([thread("a", "A", ["ui", "bug"]), thread("c", "C", ["bug"])])).toEqual([{ tag: "bug", count: 2 }, { tag: "ui", count: 1 }]);
  });

  it("renames onto an existing tag without duplicating it", () => {
    expect(renameTagIn(["bug", "ui"], "ui", "bug")).toEqual(["bug"]);
    expect(renameTagIn(["ui"], "bug", "defect")).toBeUndefined();
  });
});

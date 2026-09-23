import { expect, it } from "vitest";
import { searchSessionTitles } from "./session-search.js";
import type { Session } from "./types.js";

const session = (id: string, title: string, updatedAt: string, pinned = false) => ({ id, title, updatedAt, pinned }) as Session;

it("ranks exact titles first and other title matches by activity, not pins or prefixes", () => {
  const sessions = [session("old", "Browser tools", "2026-01-01", true), session("new", "Fix browser", "2026-02-01"), session("exact", "Browser", "2025-01-01")];
  expect(searchSessionTitles(sessions, " Browser ").map((item) => item.id)).toEqual(["exact", "new", "old"]);
  expect(sessions.map((item) => item.id)).toEqual(["old", "new", "exact"]);
});

it("orders empty searches by recency and uses stable ties for missing dates", () => {
  const sessions = [session("b", "Second", "invalid"), session("a", "First", ""), session("recent", "Latest", "2026-01-01")];
  expect(searchSessionTitles(sessions, "").map((item) => item.id)).toEqual(["recent", "a", "b"]);
  expect(searchSessionTitles(sessions, "absent")).toEqual([]);
});

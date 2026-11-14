import { describe, expect, it } from "vitest";
import { findSummary } from "./browser-find";

describe("browser find summary", () => {
  it("says nothing until there is a query and a result", () => {
    expect(findSummary(undefined, "x")).toBe("");
    expect(findSummary({ activeMatchOrdinal: 1, matches: 3 }, "  ")).toBe("");
  });
  it("counts matches", () => {
    expect(findSummary({ activeMatchOrdinal: 2, matches: 5 }, "a")).toBe("2 of 5");
    expect(findSummary({ activeMatchOrdinal: 0, matches: 0 }, "a")).toBe("No matches");
  });
});

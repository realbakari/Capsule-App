import { describe, expect, it } from "vitest";
import { sortTreeEntries } from "./FileTree";

describe("sortTreeEntries", () => {
  it("hides junk directories, puts folders first, and sorts by name", () => {
    const sorted = sortTreeEntries([
      { name: "z.ts", path: "z.ts", type: "file" },
      { name: "src", path: "src", type: "directory" },
      { name: "node_modules", path: "node_modules", type: "directory" },
      { name: ".DS_Store", path: ".DS_Store", type: "file" },
      { name: "a.ts", path: "a.ts", type: "file" },
      { name: "lib", path: "lib", type: "directory" },
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["lib", "src", "a.ts", "z.ts"]);
  });
});

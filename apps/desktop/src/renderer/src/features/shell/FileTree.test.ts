import { describe, expect, it } from "vitest";
import { indexGitMarks, sortTreeEntries } from "./FileTree";

describe("sortTreeEntries", () => {
  it("indexes file suffixes and ancestors once, preserving first-match precedence", () => {
    const marks = indexGitMarks([{ path: "src/a.ts", code: " M" }, { path: "src/b.ts", code: " D" }, { path: "nested/src/a.ts", code: " A" }]);
    expect(marks.file.get("a.ts")).toBe("M");
    expect(marks.directory.get("src")).toBe("M");
    expect(marks.file.get("nested/src/a.ts")).toBe("A");
    expect(marks.file.get("not-changed.ts")).toBeUndefined();
  });
  it("does not scan changed files again for each visible row", () => {
    let reads = 0;
    const changes = Array.from({ length: 6_000 }, (_, index) => ({ get path() { reads++; return `src/${index}.ts`; }, code: "M" }));
    const marks = indexGitMarks(changes);
    const indexedReads = reads;
    for (let index = 0; index < 6_000; index++) expect(marks.file.get(`src/${index}.ts`)).toBe("M");
    expect(reads).toBe(indexedReads);
    expect(reads).toBeLessThan(20_000);
  });
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

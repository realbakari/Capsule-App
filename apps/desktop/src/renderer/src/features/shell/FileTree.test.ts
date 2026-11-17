import { describe, expect, it } from "vitest";
import { indexGitMarks, searchTree, sortTreeEntries } from "./FileTree";

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
  it("hides only .git and .DS_Store, keeps ignored folders, puts folders first, and sorts by name", () => {
    const sorted = sortTreeEntries([
      { name: "z.ts", path: "z.ts", type: "file" },
      { name: "src", path: "src", type: "directory" },
      { name: "node_modules", path: "node_modules", type: "directory", ignored: true },
      { name: ".git", path: ".git", type: "directory" },
      { name: ".DS_Store", path: ".DS_Store", type: "file" },
      { name: "a.ts", path: "a.ts", type: "file" },
      { name: "lib", path: "lib", type: "directory" },
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["lib", "node_modules", "src", "a.ts", "z.ts"]);
  });
});

describe("searchTree", () => {
  it("nests hits under every folder on their path, once each, folders first", () => {
    const tree = searchTree([
      { name: "util.ts", path: "src/lib/util.ts", type: "file" },
      { name: "index.ts", path: "src/index.ts", type: "file" },
      { name: "util.md", path: "util.md", type: "file" },
    ]);
    expect(tree.roots.map((entry) => entry.path)).toEqual(["src", "util.md"]);
    expect(tree.children.src?.map((entry) => entry.path)).toEqual(["src/lib", "src/index.ts"]);
    expect(tree.children["src/lib"]?.map((entry) => entry.path)).toEqual(["src/lib/util.ts"]);
    expect([...tree.folders].sort()).toEqual(["src", "src/lib"]);
  });
});

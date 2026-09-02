import { describe, expect, it } from "vitest";
import type { FileEntry } from "@capsule/shared";

import { sameListing } from "./file-listing";

const entry = (path: string, type: FileEntry["type"] = "file"): FileEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  type,
});

describe("sameListing", () => {
  it("treats an equal listing as unchanged", () => {
    expect(sameListing([entry("a.ts"), entry("b.ts")], [entry("a.ts"), entry("b.ts")])).toBe(true);
  });

  it("notices a new file, a rename, and a path that became a folder", () => {
    expect(sameListing([entry("a.ts")], [entry("a.ts"), entry("b.ts")])).toBe(false);
    expect(sameListing([entry("a.ts")], [entry("b.ts")])).toBe(false);
    expect(sameListing([entry("src")], [entry("src", "directory")])).toBe(false);
  });
});

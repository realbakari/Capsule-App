import fs, { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeFileAtomic } from "./atomic-write.js";

describe("writeFileAtomic", () => {
  it("writes the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "nested", "thing.txt");
    writeFileAtomic(file, "hello");
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("leaves the old contents when the write fails", () => {
    /*
     * The point of the whole thing. A truncating write that dies halfway
     * leaves an empty file and no copy of what it held — and this is how the
     * editor writes the user's own source.
     */
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "keep.txt");
    writeFileSync(file, "original");
    chmodSync(file, 0o600);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("Rename failed"); });
    try { expect(() => writeFileAtomic(file, "replacement")).toThrow("Rename failed"); }
    finally { rename.mockRestore(); }
    expect(readFileSync(file, "utf8")).toBe("original");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["keep.txt"]);
  });

  it.each([0o755, 0o600, 0o000])("preserves existing permissions %i", (mode) => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "source");
    writeFileSync(file, "old");
    chmodSync(file, mode);
    writeFileAtomic(file, "new");
    expect(statSync(file).mode & 0o777).toBe(mode);
    chmodSync(file, 0o600);
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("honors an explicit zero mode", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "private");
    writeFileAtomic(file, "private", { mode: 0 });
    expect(statSync(file).mode & 0o777).toBe(0);
    chmodSync(file, 0o600);
  });

  it("keeps the mode a secret file needs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "secrets.json");
    writeFileAtomic(file, "{}", { mode: 0o600 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("does not leave its temporary file behind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    writeFileAtomic(path.join(dir, "a.txt"), "one");
    writeFileAtomic(path.join(dir, "a.txt"), "two");
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });

  it("replaces rather than appends", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-atomic-"));
    const file = path.join(dir, "b.txt");
    writeFileAtomic(file, "longer original contents");
    writeFileAtomic(file, "short");
    expect(readFileSync(file, "utf8")).toBe("short");
    expect(existsSync(file)).toBe(true);
  });
});

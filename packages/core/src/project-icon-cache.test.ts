import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ProjectIconCache } from "./project-icon-cache.js";

it("reuses an icon across repeated shell reads and refreshes changed images after expiry or an explicit edit", () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "capsule-icon-cache-"));
  const image = path.join(directory, "favicon.png");
  fs.writeFileSync(image, "first image");
  const cache = new ProjectIconCache();
  const reads = vi.spyOn(fs, "openSync");
  try {
    const first = cache.read(directory, undefined, 0);
    const count = reads.mock.calls.length;
    expect(first).toBe(`data:image/png;base64,${Buffer.from("first image").toString("base64")}`);
    for (let index = 0; index < 100; index++) expect(cache.read(directory, undefined, index)).toBe(first);
    expect(reads.mock.calls.length).toBe(count);
    fs.writeFileSync(image, "second image");
    expect(cache.read(directory, undefined, 60_000)).toBe(`data:image/png;base64,${Buffer.from("second image").toString("base64")}`);
    fs.writeFileSync(image, "third image");
    cache.clear();
    expect(cache.read(directory, undefined, 60_001)).toBe(`data:image/png;base64,${Buffer.from("third image").toString("base64")}`);
  } finally { reads.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }); }
});

it("retries missing icons promptly and keeps different project roots separate", () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "capsule-icon-missing-"));
  const cache = new ProjectIconCache();
  try {
    expect(cache.read(directory, undefined, 0)).toBeUndefined();
    fs.writeFileSync(path.join(directory, "favicon.png"), "new");
    expect(cache.read(directory, undefined, 4_999)).toBeUndefined();
    expect(cache.read(directory, undefined, 5_000)).toContain("base64,");
    expect(cache.read(path.join(directory, "missing"), undefined, 5_000)).toBeUndefined();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

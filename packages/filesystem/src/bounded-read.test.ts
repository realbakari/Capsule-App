import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readBoundedFile, readBoundedFileSync } from "./bounded-read.js";
import { readProjectFile } from "./project-file.js";
import { FilesystemAdapter } from "./index.js";

const directories: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), "capsule-bounded-read-"));
  directories.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("refuses oversized configuration before allocating or reading its contents", async () => {
  const root = fixture();
  const file = path.join(root, "capsule.json");
  fs.writeFileSync(file, "{}");
  fs.truncateSync(file, 500_000_000);
  const read = vi.spyOn(fs, "readSync");
  expect(readProjectFile(root)).toMatchObject({ status: "invalid", error: expect.stringContaining("too large") });
  expect(read).not.toHaveBeenCalled();
  await expect(readBoundedFile(file, 100)).rejects.toThrow("too large");
});

it.skipIf(process.platform === "win32")("rejects special files without waiting for a writer", async () => {
  const root = fixture();
  const file = path.join(root, "capsule.json");
  execFileSync("mkfifo", [file]);
  expect(readProjectFile(root)).toMatchObject({ status: "invalid", error: expect.stringContaining("regular files") });
  expect(() => new FilesystemAdapter(root).read("capsule.json")).toThrow("regular files");
  await expect(readBoundedFile(file, 100)).rejects.toThrow("regular files");
}, 2000);

it("bounds allocation and rejects growth after the descriptor size check", () => {
  const root = fixture();
  const file = path.join(root, "changing.txt");
  fs.writeFileSync(file, "small");
  const read = fs.readSync;
  const spy = vi.spyOn(fs, "readSync").mockImplementationOnce((...args: Parameters<typeof fs.readSync>) => {
    fs.appendFileSync(file, "much larger now");
    return read(...args);
  });
  expect(() => readBoundedFileSync(file, 10)).toThrow("changed while reading");
  expect((spy.mock.calls[0]![1] as Buffer).length).toBe(6);
});

it("checks symlink targets for reads, previews, directory listing, and creation", async () => {
  const root = fixture();
  const outside = fixture();
  fs.writeFileSync(path.join(outside, "private.txt"), "not project content");
  fs.symlinkSync(outside, path.join(root, "external"), "dir");
  fs.symlinkSync(path.join(outside, "private.txt"), path.join(root, "external.txt"));
  const adapter = new FilesystemAdapter(root);
  for (const relative of ["external.txt", "external/private.txt"]) {
    expect(() => adapter.read(relative)).toThrow("outside");
    expect(() => adapter.preview(relative)).toThrow("outside");
  }
  expect(() => adapter.list("external")).toThrow("outside");
  expect(() => adapter.write("external/new.txt", "no")).toThrow("outside");
  expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);

  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "inside.txt"), "project content");
  fs.symlinkSync(path.join(root, "src"), path.join(root, "alias"), "dir");
  expect(adapter.read("alias/inside.txt")).toBe("project content");
  expect(await adapter.preview("alias/inside.txt")).toMatchObject({ contents: "project content" });
  adapter.write("alias/new.txt", "allowed");
  expect(adapter.read("src/new.txt")).toBe("allowed");
});

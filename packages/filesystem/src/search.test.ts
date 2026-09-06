import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { searchContents } from "./search.js";
import { clearFileIndex, projectFiles } from "./file-index.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "capsule async search "));
  roots.push(root); return root;
}
afterEach(async () => { clearFileIndex(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it("honours Git ignores, handles spaces, bounds hits, and refuses links outside the root", async () => {
  const root = await fixture(); const outside = await fixture();
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await mkdir(path.join(root, "ignored"));
  await writeFile(path.join(root, "ignored/hidden.txt"), "secret needle");
  await writeFile(path.join(outside, "private.txt"), "secret needle");
  await symlink(path.join(outside, "private.txt"), path.join(root, "escape.txt"));
  await writeFile(path.join(root, "a file.txt"), "NEEDLE\nneedle\nneedle\nneedle");
  await writeFile(path.join(root, "b.txt"), "needle\n");
  await writeFile(path.join(root, "large.txt"), "needle".repeat(100_000));
  await writeFile(path.join(root, "binary.txt"), "needle\0");
  const hits = await searchContents(root, "needle");
  expect(hits.map((hit) => hit.path)).toEqual(["a file.txt", "a file.txt", "a file.txt", "b.txt"]);
  expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 1]);
  expect(await searchContents(root, "needle", 2)).toHaveLength(2);
});

it("shares a cold index and keeps the event loop available through a no-match search", async () => {
  const root = await fixture();
  await Promise.all(Array.from({ length: 300 }, (_, index) => writeFile(path.join(root, `${index}.ts`), "const value = 1;\n".repeat(1_000))));
  const [first, second] = await Promise.all([projectFiles(root), projectFiles(root)]);
  expect(second).toBe(first);
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 1);
  try { expect(await searchContents(root, "no match in this tree")).toEqual([]); }
  finally { clearInterval(ticker); }
  expect(ticks).toBeGreaterThan(0);
});

it("does not refill an invalidated index with the old in-flight scan", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "before.txt"), "before");
  const pending = projectFiles(root);
  clearFileIndex(root);
  await pending;
  await writeFile(path.join(root, "after.txt"), "after");
  expect(await projectFiles(root)).toContain("after.txt");
});

it("reports unavailable folders and Git index failures instead of searching ignored files", async () => {
  const root = await fixture();
  await expect(searchContents(path.join(root, "missing"), "needle")).rejects.toThrow();
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, ".git/index"), "broken index");
  await expect(searchContents(root, "needle")).rejects.toThrow();
});

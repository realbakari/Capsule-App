import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemAdapter } from "./index.js";

const marks = (entries: { name: string; ignored?: true }[]) =>
  Object.fromEntries(entries.map((entry) => [entry.name, entry.ignored === true]));

describe("FilesystemAdapter.listForTree", () => {
  it("marks what the repository ignores and keeps everything listed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-ignored-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(path.join(root, ".gitignore"), "dist/\nnode_modules\n.env\n");
    writeFileSync(path.join(root, ".env"), "TOKEN=x\n");
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "dist", "app.js"), "\n");
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "app.ts"), "\n");
    const adapter = new FilesystemAdapter(root);

    expect(marks(await adapter.listForTree())).toEqual({ ".env": true, ".git": false, ".gitignore": false, dist: true, node_modules: true, src: false });
    expect(marks(await adapter.listForTree("dist"))).toEqual({ "app.js": true });
    expect(marks(await adapter.listForTree("src"))).toEqual({ "app.ts": false });
  });

  it("falls back to the well-known build folders outside a repository", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-ignored-plain-"));
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, "lib"));
    writeFileSync(path.join(root, "notes.md"), "\n");

    expect(marks(await new FilesystemAdapter(root).listForTree())).toEqual({ lib: false, node_modules: true, "notes.md": false });
  });
});

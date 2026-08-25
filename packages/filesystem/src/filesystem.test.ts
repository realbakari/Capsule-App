import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutBranch, FilesystemAdapter, readGitDiff, readGitStatus } from "./index.js";

describe("FilesystemAdapter", () => {
  it("lists project files and rejects escapes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-fs-"));
    writeFileSync(path.join(root, "README.md"), "# Demo\n");
    const adapter = new FilesystemAdapter(root);
    expect(adapter.list().some((entry) => entry.name === "README.md")).toBe(true);
    expect(adapter.read("README.md")).toContain("Demo");
    expect(() => adapter.read("../secret.txt")).toThrow(/outside/);
  });

  it("searches nested files and skips node_modules", () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-search-"));
    writeFileSync(path.join(root, "README.md"), "# Demo\n");
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "app.ts"), "export {}\n");
    const adapter = new FilesystemAdapter(root);
    const hits = adapter.search("app");
    expect(hits.some((entry) => entry.path.endsWith("app.ts"))).toBe(true);
    expect(adapter.search("README").some((entry) => entry.name === "README.md")).toBe(true);
  });

  it("reports git changes, branches, and diffs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-git-"));
    spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "dev@capsule.local"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Capsule"], { cwd: root });
    writeFileSync(path.join(root, "README.md"), "one\n");
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-m", "init"], { cwd: root });
    writeFileSync(path.join(root, "README.md"), "two\n");
    const status = readGitStatus(root);
    expect(status.isRepo).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.files.some((item) => item.path.includes("README.md"))).toBe(true);
    expect(status.branches.length).toBeGreaterThan(0);
    expect(readGitDiff(root, "README.md")).toContain("two");
    spawnSync("git", ["checkout", "-b", "feature"], { cwd: root });
    const switched = checkoutBranch(root, status.branch ?? "HEAD");
    expect(switched.ok).toBe(true);
  });
});

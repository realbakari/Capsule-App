import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemAdapter } from "./index.js";

describe("FilesystemAdapter", () => {
  it("lists project files and rejects escapes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-fs-"));
    writeFileSync(path.join(root, "README.md"), "# Demo\n");
    const adapter = new FilesystemAdapter(root);
    expect(adapter.list().some((entry) => entry.name === "README.md")).toBe(true);
    expect(adapter.read("README.md")).toContain("Demo");
    expect(() => adapter.read("../secret.txt")).toThrow(/outside/);
  });
});

import { describe, expect, it } from "vitest";
import { fileKind } from "./file-kind.js";

describe("fileKind", () => {
  it("reads the extension", () => {
    expect(fileKind("engine.ts").label).toBe("TS");
    expect(fileKind("styles.css").label).toBe("CS");
    expect(fileKind("notes.md").label).toBe("MD");
  });

  it("is case insensitive", () => {
    expect(fileKind("README.MD").label).toBe("MD");
    expect(fileKind("Component.TSX").label).toBe("TS");
  });

  it("prefers a whole-name match over the extension", () => {
    // Both are .json and .yaml, but a manifest and a lockfile are not alike.
    expect(fileKind("package.json").label).toBe("PK");
    expect(fileKind("package-lock.json").label).toBe("LK");
    expect(fileKind("pnpm-lock.yaml").label).toBe("LK");
    expect(fileKind("config.yaml").label).toBe("YM");
  });

  it("handles dotfiles and extensionless names without reading past the name", () => {
    expect(fileKind(".gitignore").label).toBe("GI");
    expect(fileKind("Makefile").label).toBe("MK");
    expect(fileKind("LICENSE")).toEqual({ label: "•", tone: "--text-faint" });
    expect(fileKind("trailing.")).toEqual({ label: "•", tone: "--text-faint" });
  });

  it("falls back for an unknown extension rather than showing it raw", () => {
    const kind = fileKind("archive.xyzzy");
    expect(kind.label).toBe("•");
    expect(kind.label.length).toBeLessThanOrEqual(2);
  });

  it("keeps every label short enough for the icon column", () => {
    for (const name of ["a.ts", "b.json", "c.sh", "package.json", ".env", "d.unknown"]) {
      expect(fileKind(name).label.length).toBeLessThanOrEqual(2);
    }
  });
});

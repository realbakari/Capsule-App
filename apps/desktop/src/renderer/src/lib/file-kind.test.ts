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
    expect(fileKind("LICENSE")).toEqual({ icon: "file", label: "•", tone: "--text-faint" });
    expect(fileKind("trailing.")).toEqual({ icon: "file", label: "•", tone: "--text-faint" });
  });

  it("falls back for an unknown extension rather than showing it raw", () => {
    const kind = fileKind("archive.xyzzy");
    expect(kind.label).toBe("•");
    expect(kind.label.length).toBeLessThanOrEqual(2);
  });

  it("gives the tree a tool's own mark where the name says which tool", () => {
    const icons = Object.fromEntries([".gitignore", ".gitattributes", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
      "README.md", "tsconfig.json", "settings.jsonc", "vite.config.ts", "vitest.config.mts", "AGENTS.md", "CLAUDE.md", "LICENSE", ".env.example", "App.tsx"]
      .map((name) => [name, fileKind(name).icon]));
    expect(icons).toEqual({
      ".gitignore": "git", ".gitattributes": "git", "package.json": "npm", "pnpm-lock.yaml": "pnpm", "pnpm-workspace.yaml": "pnpm",
      "README.md": "markdown", "tsconfig.json": "typescript", "settings.jsonc": "json", "vite.config.ts": "vite", "vitest.config.mts": "vite",
      "AGENTS.md": "agents", "CLAUDE.md": "agents", LICENSE: "file", ".env.example": "file", "App.tsx": "react",
    });
  });

  it("only names tones the theme defines", () => {
    const defined = new Set(["--syntax-keyword", "--syntax-function", "--syntax-number", "--syntax-string", "--syntax-attribute",
      "--yellow", "--green", "--red", "--text-muted", "--text-faint"]);
    for (const name of ["a.ts", "a.tsx", "a.js", "a.json", "a.md", "a.css", "a.html", "a.py", "a.rs", "a.go", "a.sh", "a.yml", "a.toml",
      "a.png", "a.svg", "a.pdf", "a.sql", "a.lock", "a.txt", "package.json", "pnpm-lock.yaml", "Dockerfile", "Makefile", "AGENTS.md", "vite.config.ts", "x"]) {
      expect(defined, name).toContain(fileKind(name).tone);
    }
  });

  it("keeps every label short enough for the icon column", () => {
    for (const name of ["a.ts", "b.json", "c.sh", "package.json", ".env", "d.unknown"]) {
      expect(fileKind(name).label.length).toBeLessThanOrEqual(2);
    }
  });
});

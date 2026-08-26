import { describe, expect, it } from "vitest";
import {
  formatProjectRoot,
  formatWorkspaceRelativePath,
  projectFolderName,
  splitPathAndPosition,
} from "./paths.js";

describe("splitPathAndPosition", () => {
  it("splits line and column, and leaves bare paths alone", () => {
    expect(splitPathAndPosition("src/app.ts")).toEqual({ path: "src/app.ts" });
    expect(splitPathAndPosition("src/app.ts:42")).toEqual({ path: "src/app.ts", line: "42" });
    expect(splitPathAndPosition("src/app.ts:42:7")).toEqual({
      path: "src/app.ts",
      line: "42",
      column: "7",
    });
  });

  it("does not treat a Windows drive letter as a position", () => {
    expect(splitPathAndPosition("C:/code/app.ts")).toEqual({ path: "C:/code/app.ts" });
  });
});

describe("formatWorkspaceRelativePath", () => {
  const root = "/Users/realbakari/Downloads/awesome-design-md-main";

  it("renders a file under the root against the root's basename", () => {
    expect(formatWorkspaceRelativePath(`${root}/src/app.ts`, root)).toBe(
      "awesome-design-md-main/src/app.ts",
    );
  });

  it("renders the root itself as its basename", () => {
    expect(formatWorkspaceRelativePath(root, root)).toBe("awesome-design-md-main");
  });

  it("tolerates a trailing separator on the root", () => {
    expect(formatWorkspaceRelativePath(`${root}/src/app.ts`, `${root}/`)).toBe(
      "awesome-design-md-main/src/app.ts",
    );
  });

  it("preserves a line:column suffix", () => {
    expect(formatWorkspaceRelativePath(`${root}/src/app.ts:42:7`, root)).toBe(
      "awesome-design-md-main/src/app.ts:42:7",
    );
  });

  it("prefixes a relative path with the workspace label", () => {
    expect(formatWorkspaceRelativePath("./src/app.ts", root)).toBe(
      "awesome-design-md-main/src/app.ts",
    );
  });

  it("does not double the label when the path already carries it", () => {
    expect(formatWorkspaceRelativePath("awesome-design-md-main/src/app.ts", root)).toBe(
      "awesome-design-md-main/src/app.ts",
    );
  });

  it("leaves a path outside the root absolute rather than faking containment", () => {
    expect(formatWorkspaceRelativePath("/etc/hosts", root)).toBe("/etc/hosts");
  });

  it("passes the path through when there is no root", () => {
    expect(formatWorkspaceRelativePath("/etc/hosts", undefined)).toBe("/etc/hosts");
  });
});

describe("formatProjectRoot", () => {
  const home = "/Users/realbakari";

  it("abbreviates the home directory", () => {
    expect(formatProjectRoot("/Users/realbakari/Downloads/site", { home })).toBe("~/Downloads/site");
  });

  it("abbreviates the home directory itself", () => {
    expect(formatProjectRoot(home, { home })).toBe("~");
  });

  it("does not abbreviate a sibling that merely shares the prefix", () => {
    expect(formatProjectRoot("/Users/realbakari-backup/site", { home })).toBe(
      "/Users/realbakari-backup/site",
    );
  });

  it("does not abbreviate another account's home", () => {
    expect(formatProjectRoot("/Users/someone-else/site", { home })).toBe("/Users/someone-else/site");
  });

  it("leaves paths outside home alone and trims trailing separators", () => {
    expect(formatProjectRoot("/opt/homebrew/bin/", { home })).toBe("/opt/homebrew/bin");
  });

  it("returns the path unchanged when home is unknown", () => {
    expect(formatProjectRoot("/Users/realbakari/Downloads/site")).toBe(
      "/Users/realbakari/Downloads/site",
    );
  });

  it("tolerates a trailing separator on home", () => {
    expect(formatProjectRoot("/Users/realbakari/site", { home: "/Users/realbakari/" })).toBe(
      "~/site",
    );
  });

  it("falls back when unset or blank", () => {
    expect(formatProjectRoot(undefined, { home })).toBe("not set");
    expect(formatProjectRoot("   ", { home })).toBe("not set");
    expect(formatProjectRoot(undefined, { home, fallback: "No working directory" })).toBe(
      "No working directory",
    );
  });
});

describe("projectFolderName", () => {
  it("returns the folder name", () => {
    expect(projectFolderName("/Users/realbakari/Downloads/site/")).toBe("site");
    expect(projectFolderName(undefined)).toBeUndefined();
  });
});

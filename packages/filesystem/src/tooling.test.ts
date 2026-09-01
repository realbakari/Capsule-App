import { describe, expect, it } from "vitest";
import { detectSourceControlTools, parseGhAccount, parseToolVersion } from "./tooling.js";

describe("parseToolVersion", () => {
  it("reads the number out of each tool's banner", () => {
    // Verbatim from the tools on a real machine.
    expect(parseToolVersion("git version 2.50.1 (Apple Git-155)")).toBe("2.50.1");
    expect(parseToolVersion("gh version 2.95.0 (2026-06-17)\nhttps://github.com/cli/cli")).toBe(
      "2.95.0",
    );
  });

  it("ignores the install-specific tail, which differs per machine", () => {
    expect(parseToolVersion("git version 2.39.5 (Apple Git-154)")).toBe("2.39.5");
    expect(parseToolVersion("git version 2.44.0")).toBe("2.44.0");
  });

  it("accepts a leading v and a two-part number", () => {
    expect(parseToolVersion("thing version v3.1")).toBe("3.1");
  });

  it("returns nothing rather than a sentence when there is no number", () => {
    // A version field showing prose is worse than an empty one.
    expect(parseToolVersion("command not found")).toBeUndefined();
    expect(parseToolVersion("")).toBeUndefined();
  });
});

describe("parseGhAccount", () => {
  it("reads the account out of gh auth status", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account octocat (keyring)",
      "  - Active account: true",
    ].join("\n");
    expect(parseGhAccount(output)).toBe("octocat");
  });

  it("handles an enterprise host", () => {
    expect(parseGhAccount("  ✓ Logged in to ghe.example.com account sam (oauth)")).toBe("sam");
  });

  it("returns nothing when signed out", () => {
    expect(parseGhAccount("You are not logged into any GitHub hosts.")).toBeUndefined();
  });
});

describe("detectSourceControlTools", () => {
  const tools = detectSourceControlTools();

  it("reports only the tools Capsule actually uses", () => {
    // Naming a provider Capsule has no integration for would tell someone to
    // install something it would then ignore.
    expect(tools.map((tool) => tool.id)).toEqual(["git", "gh"]);
  });

  it("gives a version when a tool is installed, and guidance when it is not", () => {
    for (const tool of tools) {
      if (tool.installed) {
        expect(tool.version, tool.id).toMatch(/^\d/);
      } else {
        expect(tool.guidance, tool.id).toBeTruthy();
      }
    }
  });

  it("never leaves a missing tool without something to do about it", () => {
    for (const tool of tools) {
      if (!tool.installed) expect(tool.guidance).toContain("`");
    }
  });
});

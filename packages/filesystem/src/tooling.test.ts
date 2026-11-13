import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("detectSourceControlTools with stand-in tools", () => {
  const originalPath = process.env.PATH;
  const dirs: string[] = [];
  afterEach(() => {
    process.env.PATH = originalPath;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A PATH holding only stand-in git and gh. Each invocation is logged to
   * `calls`, waits `delay` seconds, and gh reports signed in or out.
   */
  function standIns({ delay = 0, signedIn = true, gh = true } = {}): string {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-tools-"));
    dirs.push(dir);
    const calls = path.join(dir, "calls");
    writeFileSync(calls, "");
    const write = (name: string, body: string) => {
      writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\nsleep ${delay}\n${body}\n`);
      chmodSync(path.join(dir, name), 0o755);
    };
    write("git", 'echo "git version 2.50.1 (Apple Git-155)"');
    if (gh) {
      write(
        "gh",
        signedIn
          ? 'if [ "$1" = auth ]; then echo "  ✓ Logged in to github.com account octocat (keyring)" >&2; exit 0; fi\necho "gh version 2.95.0 (2026-06-17)"'
          : 'if [ "$1" = auth ]; then echo "You are not logged into any GitHub hosts." >&2; exit 1; fi\necho "gh version 2.95.0 (2026-06-17)"',
      );
    }
    process.env.PATH = dir;
    return calls;
  }

  it("reports versions and the signed-in account", async () => {
    standIns();
    expect(await detectSourceControlTools()).toEqual([
      { id: "git", name: "Git", command: "git", installed: true, version: "2.50.1" },
      { id: "gh", name: "GitHub CLI", command: "gh", installed: true, version: "2.95.0", account: "octocat" },
    ]);
  });

  it("tells a signed-out user how to sign in", async () => {
    standIns({ signedIn: false });
    const [, gh] = await detectSourceControlTools();
    expect(gh).toEqual({
      id: "gh",
      name: "GitHub CLI",
      command: "gh",
      installed: true,
      version: "2.95.0",
      guidance: "Signed out. Run `gh auth login` to open pull requests from Capsule.",
    });
  });

  it("gives install guidance for a missing tool, and never asks a missing gh who is signed in", async () => {
    const calls = standIns({ gh: false });
    const [git, gh] = await detectSourceControlTools();
    expect(git?.installed).toBe(true);
    expect(gh).toEqual({
      id: "gh",
      name: "GitHub CLI",
      command: "gh",
      installed: false,
      guidance: "Not installed. Pull request actions stay disabled without it — `brew install gh`.",
    });
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["git --version"]);
  });

  it("keeps the event loop turning while the tools are slow", async () => {
    standIns({ delay: 0.3 });
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 10);
    try {
      const tools = await detectSourceControlTools();
      expect(tools[1]?.account).toBe("octocat");
    } finally {
      clearInterval(timer);
    }
    // A blocking spawn lets at most one tick through per probe, after it returns.
    expect(ticks).toBeGreaterThan(10);
  });

  it("shares one probe between callers that ask at the same time", async () => {
    const calls = standIns({ delay: 0.2 });
    const [first, second] = await Promise.all([detectSourceControlTools(), detectSourceControlTools()]);
    expect(second).toEqual(first);
    expect(readFileSync(calls, "utf8").trim().split("\n").sort()).toEqual([
      "gh --version",
      "gh auth status",
      "git --version",
    ]);
  });

  it("probes again once the shared probe has finished", async () => {
    const calls = standIns();
    await detectSourceControlTools();
    await detectSourceControlTools();
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(6);
  });
});

describe("detectSourceControlTools", () => {
  let tools: Awaited<ReturnType<typeof detectSourceControlTools>> = [];
  beforeAll(async () => {
    tools = await detectSourceControlTools();
  });

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

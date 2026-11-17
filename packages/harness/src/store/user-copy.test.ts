import { describe, expect, it } from "vitest";
import { copyOwner, latestSource, parseVersionOutput, userUpdatePlan, versionFromLayout, type CopyOwner } from "./user-copy.js";

const HOME = "/Users/dev";

describe("copyOwner", () => {
  it("reads an npm global from where its package lives, under any Node install", () => {
    expect(copyOwner({ harnessId: "claude", realPath: "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js" })).toEqual({
      kind: "npm", packageName: "@anthropic-ai/claude-code", packageDir: "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code", prefix: "/opt/homebrew",
    });
    expect(copyOwner({ harnessId: "codex", realPath: `${HOME}/.nvm/versions/node/v22.1.0/lib/node_modules/@openai/codex/bin/codex.js` })).toMatchObject({
      kind: "npm", packageName: "@openai/codex", prefix: `${HOME}/.nvm/versions/node/v22.1.0`,
    });
    expect(copyOwner({ harnessId: "gemini", realPath: "/usr/local/lib/node_modules/gemini-cli/dist/index.js" })).toMatchObject({ kind: "npm", packageName: "gemini-cli", prefix: "/usr/local" });
  });

  it("tells pnpm and bun globals from npm ones", () => {
    expect(copyOwner({ harnessId: "codex", realPath: `${HOME}/Library/pnpm/global/5/.pnpm/@openai+codex@1.0.0/node_modules/@openai/codex/bin/codex.js` }))
      .toMatchObject({ kind: "pnpm", packageName: "@openai/codex" });
    expect(copyOwner({ harnessId: "codex", realPath: `${HOME}/.bun/install/global/node_modules/@openai/codex/bin/codex.js` }))
      .toMatchObject({ kind: "bun", packageName: "@openai/codex" });
  });

  it("reads a Homebrew formula or cask, and its version, from the keg", () => {
    const formula = copyOwner({ harnessId: "codex", realPath: "/opt/homebrew/Cellar/codex/0.41.0_1/bin/codex" });
    expect(formula).toEqual({ kind: "homebrew", name: "codex", cask: false, prefix: "/opt/homebrew", version: "0.41.0" });
    expect(versionFromLayout(formula)).toBe("0.41.0");
    expect(copyOwner({ harnessId: "claude", realPath: "/opt/homebrew/Caskroom/claude-code/2.0.14/claude" })).toMatchObject({ kind: "homebrew", cask: true, name: "claude-code" });
  });

  it("knows a CLI that updates itself from its own versions folder", () => {
    const owner = copyOwner({ harnessId: "claude", realPath: `${HOME}/.local/share/claude/versions/2.0.14` });
    expect(owner).toEqual({ kind: "self", args: ["update"], packageName: "@anthropic-ai/claude-code", version: "2.0.14" });
    expect(latestSource(owner)).toEqual({ npm: "@anthropic-ai/claude-code" });
  });

  it("does not guess at a layout it does not recognise", () => {
    expect(copyOwner({ harnessId: "kimi", realPath: `${HOME}/.kimi-code/bin/kimi` })).toEqual({ kind: "unknown" });
    /* A package bundled inside another package is not a global install anyone can update in place. */
    expect(copyOwner({ harnessId: "codex", realPath: "/opt/app/lib/node_modules/host/node_modules/@openai/codex/bin/codex.js" })).toEqual({ kind: "unknown" });
    /* Another CLI's versions folder is not Claude's updater. */
    expect(copyOwner({ harnessId: "codex", realPath: `${HOME}/.local/share/claude/versions/2.0.14` })).toEqual({ kind: "unknown" });
  });
});

describe("parseVersionOutput", () => {
  it("takes the first version-shaped word", () => {
    expect(parseVersionOutput("2.0.14 (Claude Code)\n")).toBe("2.0.14");
    expect(parseVersionOutput("codex-cli 0.41.0")).toBe("0.41.0");
    expect(parseVersionOutput("v1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(parseVersionOutput("no version here")).toBeUndefined();
  });
});

describe("userUpdatePlan", () => {
  const npmOwner: CopyOwner = { kind: "npm", packageName: "@openai/codex", packageDir: "/opt/homebrew/lib/node_modules/@openai/codex", prefix: "/opt/homebrew" };
  const tools = (present: string[] = [], extra: Partial<{ npm: string; pnpm: string; bun: string; brew: string }> = {}) => ({ ...extra, exists: (file: string) => present.includes(file) });
  const plan = (owner: CopyOwner, version: string | undefined, latest: string | undefined, toolset = tools()) =>
    userUpdatePlan({ owner, commandPath: "/opt/homebrew/bin/codex", version, latest, tools: toolset, platform: "darwin" });

  it("offers nothing unless the latest release is newer than what is installed", () => {
    expect(plan(npmOwner, "1.0.0", "1.0.0", tools(["/opt/homebrew/bin/npm"]))).toBeUndefined();
    expect(plan(npmOwner, "1.1.0", "1.0.0", tools(["/opt/homebrew/bin/npm"]))).toBeUndefined();
    expect(plan(npmOwner, undefined, "1.0.0", tools(["/opt/homebrew/bin/npm"]))).toBeUndefined();
    expect(plan(npmOwner, "1.0.0", undefined, tools(["/opt/homebrew/bin/npm"]))).toBeUndefined();
    expect(plan(npmOwner, "1.0.0-rc.1", "1.0.0", tools(["/opt/homebrew/bin/npm"]))?.oneClick).toBe(true);
  });

  it("updates an npm global with the npm beside its own prefix, pinned to the release it found", () => {
    expect(plan(npmOwner, "1.0.0", "1.2.0", tools(["/opt/homebrew/bin/npm"], { npm: "/usr/bin/npm" }))).toEqual({
      via: "npm", command: "npm install -g @openai/codex@1.2.0", oneClick: true,
      argv: ["/opt/homebrew/bin/npm", "install", "-g", "--prefix", "/opt/homebrew", "@openai/codex@1.2.0"],
    });
  });

  it("falls back to a command to copy when the owning tool is not on this computer", () => {
    expect(plan(npmOwner, "1.0.0", "1.2.0")).toEqual({ via: "npm", command: "npm install -g @openai/codex@1.2.0", oneClick: false });
    expect(plan({ kind: "pnpm", packageName: "@openai/codex", packageDir: "x" }, "1.0.0", "1.2.0")).toMatchObject({ command: "pnpm add -g @openai/codex@1.2.0", oneClick: false });
  });

  it("runs Homebrew, bun and a self-updating CLI the way their owners expect", () => {
    expect(plan({ kind: "homebrew", name: "claude-code", cask: true, prefix: "/opt/homebrew", version: "2.0.0" }, "2.0.0", "2.0.14", tools(["/opt/homebrew/bin/brew"])))
      .toMatchObject({ via: "homebrew", command: "brew upgrade --cask claude-code", argv: ["/opt/homebrew/bin/brew", "upgrade", "--cask", "claude-code"] });
    expect(plan({ kind: "bun", packageName: "@openai/codex", packageDir: "x" }, "1.0.0", "1.2.0", tools([], { bun: "/u/.bun/bin/bun" })))
      .toMatchObject({ argv: ["/u/.bun/bin/bun", "add", "-g", "@openai/codex@latest"] });
    expect(userUpdatePlan({ owner: { kind: "self", args: ["update"], version: "2.0.0" }, commandPath: `${HOME}/.local/bin/claude`, version: "2.0.0", latest: "2.0.14", tools: tools(), platform: "darwin" }))
      .toEqual({ via: "self", command: "claude update", oneClick: true, argv: [`${HOME}/.local/bin/claude`, "update"] });
  });

  it("never offers an update for an unknown owner", () => {
    expect(plan({ kind: "unknown" }, "1.0.0", "9.0.0", tools([], { npm: "/usr/bin/npm" }))).toBeUndefined();
  });
});

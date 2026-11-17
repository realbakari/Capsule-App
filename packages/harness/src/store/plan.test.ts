import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_PACKAGE_SOURCES } from "@capsule/shared";
import { planAgentStore, platformKey, storeEntry, type AgentPlan, type HostFacts } from "./plan.js";

const registry = JSON.parse(readFileSync(new URL("./registry.fixture.json", import.meta.url), "utf8")) as {
  agents: Array<Record<string, unknown>>;
};
const npmLatest = { "@anthropic-ai/claude-code": "2.1.0", "@openai/codex": "0.80.0" };
const mac: HostFacts = { platform: "darwin", arch: "arm64", hasNode: true };

function plan(id: string, host: HostFacts = mac, extra: Partial<Parameters<typeof planAgentStore>[0]> = {}): AgentPlan {
  const found = planAgentStore({ registry, npmLatest, host, ...extra }).find((item) => item.harnessId === id);
  if (!found) throw new Error(`no plan for ${id}`);
  return found;
}

describe("platformKey", () => {
  it.each([
    ["darwin", "arm64", "darwin-aarch64"],
    ["darwin", "x64", "darwin-x86_64"],
    ["linux", "x64", "linux-x86_64"],
    ["linux", "arm64", "linux-aarch64"],
    ["win32", "x64", "windows-x86_64"],
    ["win32", "arm64", "windows-aarch64"],
    ["freebsd", "x64", undefined],
    ["linux", "ia32", undefined],
  ] as const)("%s %s is %s", (platform, arch, key) => {
    expect(platformKey(platform, arch)).toBe(key);
  });
});

describe("planAgentStore", () => {
  it("plans every sourced preset, and nothing else", () => {
    expect(planAgentStore({ registry, npmLatest, host: mac }).map((item) => item.harnessId).sort()).toEqual(
      Object.keys(AGENT_PACKAGE_SOURCES).sort(),
    );
  });

  it("installs Claude Code from its npm package at the latest version", () => {
    const claude = plan("claude");
    expect(claude.offer).toEqual({ version: "2.1.0", kind: "npm", source: AGENT_PACKAGE_SOURCES.claude, requires: "node" });
    expect(claude.recipe).toEqual({ kind: "npm", version: "2.1.0", packageName: "@anthropic-ai/claude-code", env: {} });
  });

  it("says Node is needed for npm installs when it is missing, and keeps the offer", () => {
    const noNode = { ...mac, hasNode: false };
    for (const id of ["claude", "gemini", "qwen"]) {
      const item = plan(id, noNode);
      expect(item.recipe).toBeUndefined();
      expect(item.unavailable).toMatch(/Node\.js/);
      expect(item.offer?.requires).toBe("node");
    }
    expect(plan("opencode", noNode).recipe?.kind).toBe("binary");
  });

  it("explains a missing npm version instead of guessing one", () => {
    expect(plan("codex", mac, { npmLatest: {} }).unavailable).toMatch(/couldn't check the latest version of Codex/);
  });

  it("reads an npx package spec into a name and version", () => {
    expect(plan("gemini").recipe).toEqual({ kind: "npm", version: "0.68.0", packageName: "@google/gemini-cli", env: {} });
  });

  it("prefers the binary when the registry also has an npx package", () => {
    const kilo = plan("kilocode");
    expect(kilo.recipe).toMatchObject({ kind: "binary", archive: "zip", entry: ["kilo"] });
    expect(kilo.recipe?.kind === "binary" && kilo.recipe.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [mac, "darwin/arm64/agent-cli-package.tar.gz", ["dist-package", "cursor-agent"]],
    [{ ...mac, arch: "x64" }, "darwin/x64/agent-cli-package.tar.gz", ["dist-package", "cursor-agent"]],
    [{ ...mac, platform: "linux" }, "linux/arm64/agent-cli-package.tar.gz", ["dist-package", "cursor-agent"]],
    [{ ...mac, platform: "win32", arch: "x64" }, "windows/x64/agent-cli-package.zip", ["dist-package", "cursor-agent.cmd"]],
  ] as const)("picks the platform's build (%o)", (host, urlTail, entry) => {
    const cursor = plan("cursor", host as HostFacts);
    expect(cursor.recipe?.kind === "binary" && cursor.recipe.url.endsWith(urlTail)).toBe(true);
    expect(cursor.recipe).toMatchObject({ entry });
  });

  it("uses the glibc build on Linux, not musl", () => {
    const opencode = plan("opencode", { ...mac, platform: "linux", arch: "x64" });
    expect(opencode.recipe?.kind === "binary" && opencode.recipe.url).toMatch(/opencode-linux-x64\.tar\.gz$/);
  });

  it("treats an extensionless download as the program itself and keeps its safe env", () => {
    expect(plan("muse").recipe).toMatchObject({ kind: "binary", archive: "raw", entry: ["muse"], env: { MUSE_EXPERIMENTAL_ACP: "on" } });
  });

  it("refuses a build whose command is not the one the preset launches", () => {
    const renamed = structuredClone(registry);
    const kimi = renamed.agents.find((agent) => agent.id === "kimi") as { distribution: { binary: Record<string, { cmd: string }> } };
    kimi.distribution.binary["darwin-aarch64"]!.cmd = "./kimi-cli";
    const item = plan("kimi", mac, { registry: renamed });
    expect(item.recipe).toBeUndefined();
    expect(item.unavailable).toBe("The Kimi download starts `kimi-cli`, not `kimi`, so Capsule can't launch it.");
  });

  it("refuses non-HTTPS downloads and paths that climb out of the install", () => {
    const tampered = structuredClone(registry);
    const binary = (tampered.agents.find((agent) => agent.id === "opencode") as { distribution: { binary: Record<string, { archive: string; cmd: string }> } })
      .distribution.binary;
    binary["darwin-aarch64"]!.archive = "http://example.com/opencode.zip";
    binary["darwin-x86_64"]!.cmd = "../../opencode";
    expect(plan("opencode", mac, { registry: tampered }).unavailable).toMatch(/HTTPS/);
    expect(plan("opencode", { ...mac, arch: "x64" }, { registry: tampered }).unavailable).toMatch(/can't unpack/);
  });

  it("says when there is no build for this computer", () => {
    expect(plan("kimi", { ...mac, arch: "x64" }).unavailable).toBe("Kimi has no build for this computer.");
    expect(plan("kimi", { ...mac, platform: "freebsd" }).unavailable).toBe("Kimi has no build for this computer.");
  });

  it("reports uvx agents as not supported yet rather than installing them", () => {
    const item = plan("qwen", mac, { sources: { qwen: { kind: "registry", registryId: "fast-agent" } } });
    expect(item.recipe).toBeUndefined();
    expect(item.offer).toMatchObject({ kind: "uvx", requires: "uv" });
    expect(item.unavailable).toMatch(/isn't supported yet/);
  });

  it("explains an id the registry no longer lists", () => {
    const item = plan("qwen", mac, { sources: { qwen: { kind: "registry", registryId: "no-such-agent" } } });
    expect(item.unavailable).toBe("The agent registry doesn't list Qwen Code right now.");
  });

  it("explains a missing registry", () => {
    expect(plan("opencode", mac, { registry: undefined, registryError: "offline" }).unavailable).toBe("offline");
    expect(plan("opencode", mac, { registry: undefined }).unavailable).toMatch(/no saved copy/);
  });

  it("caps registry text before it reaches a message", () => {
    const hostile = structuredClone(registry);
    const kimi = hostile.agents.find((agent) => agent.id === "kimi") as { distribution: { binary: Record<string, { cmd: string }> } };
    kimi.distribution.binary["darwin-aarch64"]!.cmd = `./${"x".repeat(500)}‮`;
    expect(plan("kimi", mac, { registry: hostile }).unavailable!.length).toBeLessThan(220);
  });

  it("shares one install between presets that launch the same command", () => {
    expect(plan("gemini-flash").storeKey).toBe("gemini");
    expect(plan("gemini").storeKey).toBe("gemini");
    expect(plan("cursor").storeKey).toBe("cursor");
  });
});

describe("storeEntry", () => {
  it("flags an update only when the managed version differs from the offer", () => {
    const opencode = plan("opencode");
    const installed = { version: "2.2.0", kind: "binary" as const, installedAt: "2026-11-01T00:00:00.000Z" };
    expect(storeEntry(opencode, installed, undefined)).toMatchObject({ installed, updateAvailable: true });
    expect(storeEntry(opencode, { ...installed, version: "2.3.0" }, undefined).updateAvailable).toBe(false);
    expect(storeEntry(opencode, undefined, { path: "/usr/local/bin/opencode", version: "2.2.0" })).toEqual({
      harnessId: "opencode",
      offer: opencode.offer,
      user: { path: "/usr/local/bin/opencode", version: "2.2.0" },
    });
  });
});

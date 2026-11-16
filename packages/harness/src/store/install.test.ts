import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentInstallProgress } from "@capsule/shared";
import { installAgent, readManifest, runProcess, StoreError, uninstallAgent, type InstallablePlan, type Runner } from "./install.js";
import { createAgentStore } from "./service.js";

const SCRIPT = '#!/bin/sh\necho "agent $1"\n';
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

let root: string;
let agentsDir: string;
let progress: AgentInstallProgress[];

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "capsule-store-"));
  agentsDir = path.join(root, "agents");
  progress = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function serve(bytes: Uint8Array | string): typeof fetch {
  return async () => new Response(typeof bytes === "string" ? bytes : new Uint8Array(bytes), { headers: { "content-length": String(bytes.length) } });
}

function rawPlan(version: string, sha256?: string): InstallablePlan {
  return {
    harnessId: "kimi",
    name: "Kimi CLI",
    command: "kimi",
    storeKey: "kimi",
    offer: { version, kind: "binary", source: { kind: "registry", registryId: "kimi" } },
    recipe: { kind: "binary", version, url: "https://example.test/kimi", archive: "raw", entry: ["kimi"], env: { KIMI_MODE: "acp" }, ...(sha256 ? { sha256 } : {}) },
  };
}

function install(plan: InstallablePlan, fetchImpl: typeof fetch, run: Runner = runProcess) {
  return installAgent({ agentsDir, platform: process.platform, fetch: fetchImpl, run, plan, report: (item) => progress.push(item) });
}

function runShim(command: string, arg: string): string {
  return spawnSync(path.join(agentsDir, "bin", command), [arg], { encoding: "utf8" }).stdout.trim();
}

describe("installAgent", () => {
  it("downloads, verifies, links a shim and records the install", async () => {
    const manifest = await install(rawPlan("1.0.0", sha(SCRIPT)), serve(SCRIPT));
    expect(manifest).toMatchObject({ version: "1.0.0", kind: "binary", target: path.join(agentsDir, "kimi", "1.0.0", "kimi") });
    expect(runShim("kimi", "--version")).toBe("agent --version");
    expect(readFileSync(path.join(agentsDir, "bin", "kimi"), "utf8")).toContain("export KIMI_MODE='acp'");
    expect(statSync(path.join(agentsDir, "bin", "kimi")).mode & 0o777).toBe(0o755);
    expect(progress.map((item) => item.phase)).toEqual(["resolving", "downloading", "downloading", "verifying", "extracting", "linking"]);
    expect(progress.find((item) => item.phase === "downloading" && "received" in item)).toMatchObject({ received: SCRIPT.length, total: SCRIPT.length });
    expect(existsSync(path.join(agentsDir, ".staging", "kimi"))).toBe(false);
  });

  it("refuses a download whose checksum does not match, and leaves nothing behind", async () => {
    await expect(install(rawPlan("1.0.0", sha("something else")), serve(SCRIPT))).rejects.toThrow(
      new StoreError("The Kimi CLI download didn't match its published checksum, so Capsule didn't install it."),
    );
    expect(existsSync(path.join(agentsDir, "bin", "kimi"))).toBe(false);
    expect(await readManifest(agentsDir, "kimi")).toBeUndefined();
    expect(existsSync(path.join(agentsDir, ".staging", "kimi"))).toBe(false);
  });

  it("converges when run again, and an update drops the old version", async () => {
    await install(rawPlan("1.0.0"), serve(SCRIPT));
    await install(rawPlan("1.0.0"), serve(SCRIPT));
    expect(readdirSync(path.join(agentsDir, "kimi")).sort()).toEqual(["1.0.0", "manifest.json"]);

    await install(rawPlan("1.1.0"), serve('#!/bin/sh\necho "new $1"\n'));
    expect(readdirSync(path.join(agentsDir, "kimi")).sort()).toEqual(["1.1.0", "manifest.json"]);
    expect(runShim("kimi", "x")).toBe("new x");
    expect((await readManifest(agentsDir, "kimi"))?.version).toBe("1.1.0");
  });

  it("recovers from a staging folder a crashed run left behind", async () => {
    mkdirSync(path.join(agentsDir, ".staging", "kimi", "payload", "junk"), { recursive: true });
    await install(rawPlan("1.0.0"), serve(SCRIPT));
    expect(readdirSync(path.join(agentsDir, "kimi", "1.0.0"))).toEqual(["kimi"]);
  });

  it("unpacks a tarball and links the nested command", async () => {
    const src = path.join(root, "src");
    mkdirSync(path.join(src, "pkg", "bin"), { recursive: true });
    writeFileSync(path.join(src, "pkg", "bin", "kimi"), SCRIPT, { mode: 0o755 });
    const tarball = path.join(root, "kimi.tar.gz");
    expect(spawnSync("tar", ["-czf", tarball, "-C", src, "pkg"]).status).toBe(0);
    const plan = rawPlan("2.0.0");
    plan.recipe = { ...plan.recipe, archive: "tar", entry: ["pkg", "bin", "kimi"] } as InstallablePlan["recipe"];
    await install(plan, serve(readFileSync(tarball)));
    expect(runShim("kimi", "hi")).toBe("agent hi");
  });

  it("says when the download does not contain the command", async () => {
    const plan = rawPlan("2.0.0");
    plan.recipe = { ...plan.recipe, archive: "tar", entry: ["missing"] } as InstallablePlan["recipe"];
    const src = path.join(root, "src");
    mkdirSync(src);
    writeFileSync(path.join(src, "other"), "x");
    const tarball = path.join(root, "k.tar.gz");
    spawnSync("tar", ["-czf", tarball, "-C", src, "other"]);
    await expect(install(plan, serve(readFileSync(tarball)))).rejects.toThrow("The Kimi CLI download doesn't contain `missing`.");
  });

  describe("npm", () => {
    const npmPlan: InstallablePlan = {
      harnessId: "gemini",
      name: "Gemini CLI",
      command: "gemini",
      storeKey: "gemini",
      offer: { version: "0.68.0", kind: "npm", source: { kind: "registry", registryId: "gemini" }, requires: "node" },
      recipe: { kind: "npm", version: "0.68.0", packageName: "@google/gemini-cli", env: {} },
    };

    function fakeNpm(bin: string | undefined): { run: Runner; calls: string[][] } {
      const calls: string[][] = [];
      const run: Runner = async (file, args) => {
        calls.push([file, ...args]);
        const prefix = args[args.indexOf("--prefix") + 1]!;
        if (bin) {
          mkdirSync(path.join(prefix, "node_modules", ".bin"), { recursive: true });
          writeFileSync(path.join(prefix, "node_modules", ".bin", bin), SCRIPT, { mode: 0o755 });
        }
        return { code: 0, stderr: "" };
      };
      return { run, calls };
    }

    it("installs the pinned package with npm argv and links its bin", async () => {
      const { run, calls } = fakeNpm("gemini");
      await installAgent({ agentsDir, platform: process.platform, fetch, run, plan: npmPlan, report: (item) => progress.push(item), npmPath: "/opt/node/bin/npm", nodeDir: "/opt/node/bin" });
      expect(calls).toEqual([
        ["/opt/node/bin/npm", "install", "--prefix", path.join(agentsDir, ".staging", "gemini", "payload"), "--no-audit", "--no-fund", "--loglevel=error", "@google/gemini-cli@0.68.0"],
      ]);
      expect(progress.map((item) => item.phase)).toEqual(["resolving", "installing", "linking"]);
      expect(runShim("gemini", "--help")).toBe("agent --help");
      expect(readFileSync(path.join(agentsDir, "bin", "gemini"), "utf8")).toContain(`export PATH="$PATH":'/opt/node/bin'`);
    });

    it("fails clearly when the package has no bin by the preset's name", async () => {
      const { run } = fakeNpm("gemini-cli");
      await expect(
        installAgent({ agentsDir, platform: process.platform, fetch, run, plan: npmPlan, report: () => undefined, npmPath: "/opt/node/bin/npm" }),
      ).rejects.toThrow("The @google/gemini-cli package doesn't provide a `gemini` command, so Capsule can't launch it.");
      expect(existsSync(path.join(agentsDir, "gemini"))).toBe(false);
    });

    it("passes npm's own error through as one line", async () => {
      const run: Runner = async () => ({ code: 1, stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/nope\n" });
      await expect(
        installAgent({ agentsDir, platform: process.platform, fetch, run, plan: npmPlan, report: () => undefined, npmPath: "/opt/node/bin/npm" }),
      ).rejects.toThrow("npm couldn't install Gemini CLI. npm error 404 Not Found - GET https://registry.npmjs.org/nope");
    });
  });
});

describe("uninstallAgent", () => {
  it("removes the shim and the agent's folder, and nothing else", async () => {
    await install(rawPlan("1.0.0"), serve(SCRIPT));
    writeFileSync(path.join(agentsDir, "bin", "opencode"), "other agent");
    writeFileSync(path.join(agentsDir, "registry.json"), "{}");
    await uninstallAgent(agentsDir, rawPlan("1.0.0"), process.platform);
    await uninstallAgent(agentsDir, rawPlan("1.0.0"), process.platform);
    expect(readdirSync(agentsDir).filter((name) => name !== ".staging").sort()).toEqual(["bin", "registry.json"]);
    expect(readdirSync(path.join(agentsDir, "bin"))).toEqual(["opencode"]);
  });
});

describe("createAgentStore", () => {
  const registry = JSON.parse(readFileSync(new URL("./registry.fixture.json", import.meta.url), "utf8")) as unknown;

  function store(fetchImpl: typeof fetch) {
    return createAgentStore({
      agentsDir,
      emit: (item) => progress.push(item),
      host: () => ({ platform: "darwin", arch: "arm64", hasNode: false }),
      userPath: () => undefined,
      changed: () => undefined,
      fetch: fetchImpl,
      platform: "darwin",
    });
  }

  it("lists from the saved registry when offline, and says so when there is none", async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await store(offline).list()).find((item) => item.harnessId === "opencode")?.unavailable).toMatch(/no saved copy/);

    const online: typeof fetch = async (url) =>
      String(url).includes("registry.npmjs.org") ? Response.json({ latest: "2.1.0" }) : Response.json(registry);
    expect((await store(online).list()).find((item) => item.harnessId === "opencode")?.offer?.version).toBe("2.3.0");

    const fromDisk = await store(offline).list();
    expect(fromDisk.find((item) => item.harnessId === "opencode")?.offer?.version).toBe("2.3.0");
    expect(fromDisk.find((item) => item.harnessId === "claude")?.unavailable).toMatch(/latest version of Claude Code/);
  });

  it("runs one install per agent at a time and reports failures as sentences", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: typeof fetch = async (url) => {
      if (String(url).includes("registry.npmjs.org")) return Response.json({ latest: "2.1.0" });
      if (String(url).endsWith("registry.json")) return Response.json(registry);
      await gate;
      return new Response("not a zip");
    };
    const agents = store(slow);
    const first = agents.install("opencode");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(agents.install("opencode")).rejects.toThrow("OpenCode is already being installed or removed.");
    release();
    await expect(first).rejects.toThrow("OpenCode download didn't match its published checksum");
    expect(progress.at(-1)).toMatchObject({ harnessId: "opencode", phase: "failed" });
    await expect(agents.install("claude")).rejects.toThrow(/Node\.js/);
  });
});

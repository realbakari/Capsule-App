import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginOptionEnvName } from "@capsule/shared";
import { readPluginFolder } from "./plugins.js";
import { ConfigService } from "./service.js";
import { createTrustStore } from "./trust.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-plugin-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A plugin that adds one of everything. */
function writePlugin(dir: string, overrides: Record<string, unknown> = {}) {
  put(path.join(dir, "capsule-plugin.json"), JSON.stringify({
    name: "acme-dev",
    version: "1.0.0",
    description: "Acme's setup",
    author: { name: "Acme" },
    contributes: { hooks: "./hooks.json", mcpServers: "./mcp.json", statusLine: { items: ["branch"], command: "${PLUGIN_ROOT}/line.sh" } },
    userConfig: {
      region: { type: "enum", title: "Region", options: ["eu", "us"], default: "eu" },
      api_token: { type: "secret", title: "API token", required: true },
    },
    ...overrides,
  }));
  put(path.join(dir, "commands", "ship.md"), "---\ndescription: Ship it\n---\nShip to ${user_config.region} from ${PLUGIN_ROOT}.\n!`git status`\n");
  put(path.join(dir, "commands", "leak.md"), "Token ${user_config.api_token}\n");
  put(path.join(dir, "hooks.json"), JSON.stringify({ hooks: { PermissionRequest: [{ matcher: "execute", hooks: [{ type: "command", command: "\"${PLUGIN_ROOT}/gate.sh\" ${user_config.api_token}" }] }] } }));
  put(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: { acme: { command: "${PLUGIN_ROOT}/server", env: { TOKEN: "${user_config.api_token}" } } } }));
  put(path.join(dir, "themes", "acme-night.json"), JSON.stringify({ name: "Acme Night", appearance: "dark", tokens: { accent: "#88aaff" } }));
  put(path.join(dir, "profiles", "reviewer.md"), "---\nname: Reviewer\nharness: claude\n---\nReview carefully.\n");
  put(path.join(dir, "styles", "terse.md"), "---\nname: Terse\n---\nBe brief.\n");
  put(path.join(dir, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Deploy the app\n---\nSteps.\n");
}

function service(userDir: string) {
  let trusted: string | undefined;
  const config = new ConfigService({
    userDir,
    lastGoodDir: path.join(userDir, "..", "last-good"),
    trust: createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } }),
    watch: false,
    appVersion: "0.11.0",
  });
  config.load();
  cleanups.push(() => config.close());
  return config;
}

describe("readPluginFolder", () => {
  it("lists exactly what a plugin adds, as written, without running anything", () => {
    const dir = temp();
    writePlugin(dir);
    const reading = readPluginFolder(dir);
    expect(reading.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(reading.contents.commands).toEqual([
      { name: "leak", shell: [] },
      { name: "ship", description: "Ship it", shell: ["git status"] },
    ]);
    expect(reading.contents.hooks).toEqual([{ event: "PermissionRequest", matcher: "execute", type: "command", run: "\"${PLUGIN_ROOT}/gate.sh\" ${user_config.api_token}" }]);
    expect(reading.contents.mcpServers).toEqual([{ name: "acme", transport: "stdio", detail: "${PLUGIN_ROOT}/server" }]);
    expect(reading.contents.themes).toEqual([{ id: "acme-night", name: "Acme Night", appearance: "dark" }]);
    expect(reading.contents.profiles).toEqual([{ id: "reviewer", name: "Reviewer" }]);
    expect(reading.contents.styles).toEqual([{ id: "terse", name: "Terse" }]);
    expect(reading.contents.skills).toEqual([{ name: "deploy", description: "Deploy the app" }]);
    expect(reading.contents.statusLine).toEqual({ items: ["branch"], command: "${PLUGIN_ROOT}/line.sh" });
  });

  it("refuses a folder or file that leads outside the plugin", () => {
    const dir = temp();
    const outside = temp();
    writePlugin(dir, { contributes: { hooks: "./hooks.json" } });
    rmSync(path.join(dir, "commands"), { recursive: true });
    symlinkSync(outside, path.join(dir, "commands"));
    const reading = readPluginFolder(dir);
    expect(reading.folders.commands).toBeUndefined();
    expect(reading.problems.some((problem) => problem.message.includes("leads outside the plugin folder"))).toBe(true);
  });

  it("names a missing manifest", () => {
    expect(readPluginFolder(temp()).problems[0]?.message).toContain("There is no capsule-plugin.json");
  });
});

describe("ConfigService plugins", () => {
  it("installs a plugin off, then adds its contributions with their source once it is on", () => {
    const source = temp();
    writePlugin(source);
    const userDir = path.join(temp(), ".capsule");
    const config = service(userDir);
    const installed = config.installPlugin(source);
    expect(installed).toMatchObject({ name: "acme-dev", enabled: false, dev: false, mayApprove: false });
    expect(existsSync(path.join(userDir, "plugins", "acme-dev", "capsule-plugin.json"))).toBe(true);
    expect(config.extended().hooks.PermissionRequest).toBeUndefined();
    expect(config.commands().commands.some((entry) => entry.command.name === "ship")).toBe(false);

    config.setPluginEnabled("acme-dev", true);
    const root = path.join(userDir, "plugins", "acme-dev");
    const manifestPath = path.join(root, "capsule-plugin.json");
    const hook = config.extended().hooks.PermissionRequest?.[0];
    expect(hook?.source).toEqual({ scope: "plugin", path: manifestPath });
    expect(hook?.value.hooks[0]).toEqual({ type: "command", command: `"${root}/gate.sh" \${${pluginOptionEnvName("api_token")}}` });
    expect(config.extended().mcpServers.acme?.source.scope).toBe("plugin");
    expect(config.extended().statusLine?.command).toBe(`${root}/line.sh`);

    const ship = config.commands().commands.find((entry) => entry.command.name === "ship");
    expect(ship?.source).toBe("plugin");
    expect(ship?.command.body).toContain(`Ship to eu from ${root}.`);
    expect(config.commands().commands.find((entry) => entry.command.name === "leak")?.command.body).toBe("Token");
    expect(config.diagnostics().problems.some((problem) => problem.message.includes("only reaches environment variables"))).toBe(true);

    expect(config.themes().themes.find((theme) => theme.id === "acme-night")?.source).toBe("plugin");
    expect(config.profiles().profiles.map((entry) => entry.profile.id)).toContain("reviewer");
    expect(config.styles().styles.map((entry) => entry.style.id)).toContain("terse");
    expect(config.pluginSkillFolders()).toEqual([{ name: "acme-dev", dir: path.join(root, "skills") }]);
    expect(config.pluginEnvironment(hook?.source)).toMatchObject({ CAPSULE_PLUGIN_ROOT: root, [pluginOptionEnvName("region")]: "eu" });

    config.setPluginEnabled("acme-dev", false);
    expect(config.extended().hooks.PermissionRequest).toBeUndefined();
    expect(config.themes().themes.some((theme) => theme.id === "acme-night")).toBe(false);
  });

  it("holds a plugin's hooks back from approving until the person lets it", () => {
    const source = temp();
    writePlugin(source);
    const config = service(path.join(temp(), ".capsule"));
    config.installPlugin(source);
    config.setPluginEnabled("acme-dev", true);
    const hookSource = config.extended().hooks.PermissionRequest![0]!.source;
    expect(config.mayApprove(hookSource)).toBe(false);
    expect(config.mayApprove({ scope: "user", path: "/x/settings.json" })).toBe(true);
    config.setPluginMayApprove("acme-dev", true);
    expect(config.mayApprove(hookSource)).toBe(true);
    expect(JSON.parse(readFileSync(config.paths.userSettings, "utf8")).plugins["acme-dev"]).toEqual({ enabled: true, mayApprove: true });
  });

  it("replaces an older version in place and keeps its settings", () => {
    const source = temp();
    writePlugin(source);
    const config = service(path.join(temp(), ".capsule"));
    config.installPlugin(source);
    config.setPluginEnabled("acme-dev", true);
    config.setPluginValues("acme-dev", { region: "us" });
    writePlugin(source, { version: "1.1.0" });
    const updated = config.installPlugin(source);
    expect(updated.reading.manifest?.version).toBe("1.1.0");
    expect(updated.enabled).toBe(true);
    expect(updated.values).toEqual({ region: "us" });
  });

  it("refuses an option value of the wrong type and a secret outside the Keychain", () => {
    const source = temp();
    writePlugin(source);
    const config = service(path.join(temp(), ".capsule"));
    config.installPlugin(source);
    expect(() => config.setPluginValues("acme-dev", { region: "mars" })).toThrow("Region must be one of eu, us.");
    expect(() => config.setPluginValues("acme-dev", { api_token: "x" })).toThrow("kept in the Keychain");
  });

  it("loads a development folder in place, picks up edits on reload, and never deletes it", () => {
    const dir = temp();
    writePlugin(dir);
    const config = service(path.join(temp(), ".capsule"));
    const loaded = config.registerDevPlugin(dir);
    expect(loaded).toMatchObject({ name: "acme-dev", dev: true, root: dir });
    config.setPluginEnabled("acme-dev", true);
    put(path.join(dir, "commands", "fresh.md"), "New command\n");
    config.reload();
    expect(config.commands().commands.some((entry) => entry.command.name === "fresh")).toBe(true);
    config.uninstallPlugin("acme-dev");
    expect(existsSync(path.join(dir, "capsule-plugin.json"))).toBe(true);
    expect(config.plugins()).toEqual([]);
  });

  it("uninstalls a copy with its folder, option values and settings entry", () => {
    const source = temp();
    writePlugin(source);
    const config = service(path.join(temp(), ".capsule"));
    config.installPlugin(source);
    config.setPluginValues("acme-dev", { region: "us" });
    config.uninstallPlugin("acme-dev");
    expect(existsSync(path.join(config.pluginsDir, "acme-dev"))).toBe(false);
    expect(existsSync(config.pluginDataDir("acme-dev"))).toBe(false);
    expect(JSON.parse(readFileSync(config.paths.userSettings, "utf8")).plugins).toBeUndefined();
  });

  it("refuses to install a folder with errors", () => {
    const source = temp();
    writePlugin(source, { name: "capsule-tools" });
    const config = service(path.join(temp(), ".capsule"));
    expect(() => config.installPlugin(source)).toThrow("reserved for Capsule");
  });
});

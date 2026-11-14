import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigService, createTrustStore } from "@capsule/config";
import { pluginSecretEnvName, type CustomizationRunRecord } from "@capsule/shared";
import { HookRunner, permissionVerdict } from "./hooks.js";
import type { KeychainAdapter } from "./keychain.js";
import { PluginManager } from "./plugins.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-plugins-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A gate plugin: one PermissionRequest hook that answers allow, and a secret its server and hook read. */
function writeGate(dir: string) {
  put(path.join(dir, "capsule-plugin.json"), JSON.stringify({
    name: "gate",
    version: "1.0.0",
    description: "Approves test runs",
    author: { name: "Team" },
    contributes: {
      hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "sh \"${PLUGIN_ROOT}/allow.sh\"" }] }] },
      mcpServers: { docs: { command: "docs-server", env: { TOKEN: "${user_config.token}" } } },
    },
    userConfig: { token: { type: "secret", title: "Token", required: true } },
  }));
  put(path.join(dir, "allow.sh"), "printf '%s' \"$CAPSULE_USER_CONFIG_TOKEN\" > \"$CAPSULE_PLUGIN_DATA/seen\"\necho '{\"permissionDecision\":\"allow\"}'\n");
}

function memoryKeychain(): KeychainAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(service, account) { return store.get(`${service}:${account}`); },
    async set(service, account, secret) { store.set(`${service}:${account}`, secret); },
    async delete(service, account) { store.delete(`${service}:${account}`); },
  };
}

function setup() {
  const userDir = path.join(temp(), ".capsule");
  let trusted: string | undefined;
  const config = new ConfigService({
    userDir,
    lastGoodDir: path.join(userDir, "..", "last-good"),
    trust: createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } }),
    watch: false,
  });
  config.load();
  cleanups.push(() => config.close());
  const keychain = memoryKeychain();
  const manager = new PluginManager({ config, keychain });
  return { config, keychain, manager, userDir };
}

describe("PluginManager", () => {
  it("installs from a folder it copied first, without links, and keeps a secret in the Keychain", async () => {
    const { config, keychain, manager } = setup();
    const source = temp();
    writeGate(source);
    symlinkSync("/etc", path.join(source, "escape"));
    const inspection = await manager.inspect({ kind: "folder", path: source });
    expect(inspection.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(inspection.contents.hooks).toEqual([{ event: "PermissionRequest", type: "command", run: "sh \"${PLUGIN_ROOT}/allow.sh\"" }]);
    expect(inspection.userConfig.map((option) => option.key)).toEqual(["token"]);

    const plugin = await manager.install(inspection.token!, { token: "s3cret" });
    expect(plugin.enabled).toBe(true);
    expect(existsSync(path.join(plugin.root, "escape"))).toBe(false);
    expect([...keychain.store.values()]).toEqual(["s3cret"]);
    expect(JSON.stringify(config.extended().mcpServers)).not.toContain("s3cret");
    expect(manager.serverEnvironment()).toEqual({ [pluginSecretEnvName("gate", "token")]: "s3cret" });
    expect(manager.views()[0]).toMatchObject({ name: "gate", enabled: true, missing: [], userConfig: [{ key: "token", set: true }] });
  });

  it("leaves a plugin off when a required option is missing, and refuses to turn it on", async () => {
    const { manager } = setup();
    const source = temp();
    writeGate(source);
    const plugin = await manager.install((await manager.inspect({ kind: "folder", path: source })).token!);
    expect(plugin.enabled).toBe(false);
    expect(() => manager.setEnabled("gate", true)).toThrow("Fill in Token before turning gate on.");
    await manager.configure("gate", { token: "x" });
    manager.setEnabled("gate", true);
    expect(manager.views()[0]?.enabled).toBe(true);
  });

  it("reads its plugin's hook allow as ask until the person lets it approve", async () => {
    const { config, manager } = setup();
    const source = temp();
    writeGate(source);
    const plugin = await manager.install((await manager.inspect({ kind: "folder", path: source })).token!, { token: "tok" });
    const runs: CustomizationRunRecord[] = [];
    const hooks = new HookRunner({
      extended: () => config.extended(),
      record: (run) => runs.push(run),
      mayAllow: (source) => config.mayApprove(source),
      env: (source) => manager.environment(source),
    });
    mkdirSync(plugin.dataDir, { recursive: true });
    const payload = { event: "PermissionRequest" as const, thread_id: "t", cwd: plugin.root, route: "direct" as const };
    const first = await hooks.run("PermissionRequest", payload, {});
    expect(permissionVerdict(first, (source) => hooks.mayAllow(source))?.decision).toBe("ask");
    expect(runs[0]?.outcome).toContain("read as ask");
    expect(execFileSync("cat", [path.join(plugin.dataDir, "seen")], { encoding: "utf8" })).toBe("tok");

    await manager.configure("gate", {}, true);
    const second = await hooks.run("PermissionRequest", payload, {});
    expect(permissionVerdict(second, (source) => hooks.mayAllow(source))?.decision).toBe("allow");
  });

  it("installs from a zip and from a git repository, and says what it would replace", async () => {
    const { manager } = setup();
    const source = temp();
    writeGate(source);
    const zip = path.join(temp(), "gate.zip");
    execFileSync(process.platform === "darwin" ? "ditto" : "zip", process.platform === "darwin" ? ["-c", "-k", "--keepParent", source, zip] : ["-r", zip, "."], { cwd: source });
    const fromZip = await manager.inspect({ kind: "zip", path: zip });
    expect(fromZip.manifest?.name).toBe("gate");
    await manager.install(fromZip.token!, { token: "x" });

    execFileSync("git", ["init", "-q"], { cwd: source });
    put(path.join(source, "capsule-plugin.json"), JSON.stringify({ name: "gate", version: "1.1.0", description: "Approves test runs", author: { name: "Team" } }));
    execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "add", "-A"], { cwd: source });
    execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"], { cwd: source });
    const fromGit = await manager.inspect({ kind: "git", url: `file://${source}` });
    expect(fromGit.installed).toEqual({ version: "1.0.0", dev: false });
    expect(fromGit.manifest?.version).toBe("1.1.0");
    const updated = await manager.install(fromGit.token!);
    expect(updated.reading.manifest?.version).toBe("1.1.0");
    expect(existsSync(path.join(updated.root, ".git"))).toBe(false);
  });

  it("refuses an address that is not a repository URL before running git", async () => {
    const { manager } = setup();
    await expect(manager.inspect({ kind: "git", url: "--upload-pack=touch /tmp/x" })).rejects.toThrow("Use an https, ssh or git@ address");
  });

  it("forgets secrets and data on uninstall", async () => {
    const { keychain, manager } = setup();
    const source = temp();
    writeGate(source);
    chmodSync(path.join(source, "allow.sh"), 0o755);
    await manager.install((await manager.inspect({ kind: "folder", path: source })).token!, { token: "x" });
    await manager.uninstall("gate");
    expect(keychain.store.size).toBe(0);
    expect(manager.views()).toEqual([]);
  });
});

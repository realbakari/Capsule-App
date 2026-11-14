import { describe, expect, it } from "vitest";
import {
  comparePluginVersions,
  parsePluginManifest,
  pluginInstallVerb,
  pluginOptionEnvName,
  pluginSecretEnvName,
  satisfiesVersionRange,
  substitutePluginVariables,
} from "./plugin.js";

const base = { name: "acme-dev", version: "1.4.0", description: "Acme's setup", author: { name: "Acme" } };

describe("parsePluginManifest", () => {
  it("accepts a complete manifest and reads its folders, files and options", () => {
    const { manifest, problems } = parsePluginManifest({
      ...base,
      capsule: ">=0.11",
      contributes: { commands: "./commands", hooks: "./hooks.json", mcpServers: { docs: { url: "https://docs.example" } }, statusLine: { items: ["branch"] } },
      userConfig: {
        api_token: { type: "secret", title: "API token", required: true },
        region: { type: "enum", title: "Region", options: ["eu", "us"], default: "eu" },
      },
    }, { appVersion: "0.11.0" });
    expect(problems).toEqual([]);
    expect(manifest?.folders).toEqual({ commands: "./commands" });
    expect(manifest?.hooks).toBe("./hooks.json");
    expect(manifest?.userConfig.map((option) => [option.key, option.type, option.default])).toEqual([["api_token", "secret", undefined], ["region", "enum", "eu"]]);
  });

  it("requires name, version, description and author", () => {
    const { manifest, problems } = parsePluginManifest({});
    expect(manifest).toBeUndefined();
    expect(problems.map((problem) => problem.key)).toEqual(["name", "version", "description", "author"]);
  });

  it("refuses names that would pass for part of Capsule", () => {
    for (const name of ["capsule", "capsule-tools", "settings", "claude", "paper"]) {
      expect(parsePluginManifest({ ...base, name }).manifest, name).toBeUndefined();
    }
  });

  it("refuses a version that is not semantic, a Capsule it does not run on, and paths that leave the plugin", () => {
    expect(parsePluginManifest({ ...base, version: "1.4" }).problems[0]?.key).toBe("version");
    expect(parsePluginManifest({ ...base, capsule: ">=2.0" }, { appVersion: "0.11.0" }).problems[0]?.message).toContain("needs Capsule >=2.0");
    expect(parsePluginManifest({ ...base, contributes: { commands: "../elsewhere" } }).manifest).toBeUndefined();
    expect(parsePluginManifest({ ...base, contributes: { hooks: "/etc/hooks.json" } }).manifest).toBeUndefined();
  });

  it("warns about what it ignores, project actions included, without refusing the plugin", () => {
    const { manifest, problems } = parsePluginManifest({ ...base, extra: 1, contributes: { actions: [{ name: "Lint", command: "pnpm lint" }] } });
    expect(manifest).toBeDefined();
    expect(problems.map((problem) => [problem.severity, problem.key])).toEqual([["warning", "extra"], ["warning", "contributes.actions"]]);
  });

  it("refuses a secret with a default and an enum without choices", () => {
    expect(parsePluginManifest({ ...base, userConfig: { token: { type: "secret", title: "Token", default: "x" } } }).manifest).toBeUndefined();
    expect(parsePluginManifest({ ...base, userConfig: { mode: { type: "enum", title: "Mode" } } }).manifest).toBeUndefined();
  });
});

describe("substitutePluginVariables", () => {
  const variables = { root: "/plugins/acme-dev", data: "/data/acme-dev", values: { region: "eu" }, secrets: new Set(["api_token"]) };

  it("fills in paths and options in text, and refuses a secret there", () => {
    expect(substitutePluginVariables("${PLUGIN_ROOT}/x ${PLUGIN_DATA} ${user_config.region}", "acme-dev", variables, "text")).toEqual({ text: "/plugins/acme-dev/x /data/acme-dev eu", problems: [] });
    const secret = substitutePluginVariables("token ${user_config.api_token}", "acme-dev", variables, "text");
    expect(secret.text).toBe("token ");
    expect(secret.problems[0]).toContain("only reaches environment variables");
  });

  it("turns options into environment references in a shell command, so a value never becomes shell text", () => {
    expect(substitutePluginVariables(`"\${PLUGIN_ROOT}/gate.sh" --region \${user_config.region} \${user_config.api_token}`, "acme-dev", variables, "shell").text)
      .toBe(`"/plugins/acme-dev/gate.sh" --region \${${pluginOptionEnvName("region")}} \${${pluginOptionEnvName("api_token")}}`);
  });

  it("turns a secret into an environment reference for an MCP server's env, filled at spawn", () => {
    expect(substitutePluginVariables("Bearer ${user_config.api_token}", "acme-dev", variables, "env").text).toBe(`Bearer \${env:${pluginSecretEnvName("acme-dev", "api_token")}}`);
  });
});

describe("versions", () => {
  it("orders versions and reads ranges", () => {
    expect(comparePluginVersions("1.10.0", "1.9.3")).toBe(1);
    expect(comparePluginVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(satisfiesVersionRange("0.11.0", ">=0.11")).toBe(true);
    expect(satisfiesVersionRange("0.12.1", "^0.11.0")).toBe(false);
    expect(satisfiesVersionRange("1.4.2", "^1.2")).toBe(true);
    expect(satisfiesVersionRange("1.3.0", "~1.2")).toBe(false);
    expect(satisfiesVersionRange("1.3.0", ">=1.0 <2")).toBe(true);
  });

  it("says whether an install is new, an update, a reinstall or going back", () => {
    expect(pluginInstallVerb({ manifest: { ...base, version: "1.4.0" } })).toBe("Install");
    expect(pluginInstallVerb({ manifest: { ...base, version: "1.4.0" }, installed: { version: "1.3.2", dev: false } })).toBe("Update from 1.3.2 to 1.4.0");
    expect(pluginInstallVerb({ manifest: { ...base, version: "1.4.0" }, installed: { version: "1.4.0", dev: false } })).toBe("Reinstall 1.4.0");
    expect(pluginInstallVerb({ manifest: { ...base, version: "1.2.0" }, installed: { version: "1.4.0", dev: false } })).toBe("Go back from 1.4.0 to 1.2.0");
  });
});

import { describe, expect, it } from "vitest";
import { appRestartInput, commandExpandInput, configFileTarget, keybindingEdit, mcpEnabledInput, mcpTestInput, permissionRuleEdit, profileCreateInput, setConfigValueInput, themeImportInput } from "./config-args.js";

const CHANNEL = "capsule:config:test";

describe("settings-file channel arguments", () => {
  it("passes a well-formed write through, and a missing value as Reset", () => {
    expect(setConfigValueInput({ key: "diffLayout", value: "unified", scope: "project", projectId: "proj_1" }, CHANNEL, 0))
      .toEqual({ key: "diffLayout", value: "unified", scope: "project", projectId: "proj_1" });
    expect(setConfigValueInput({ key: "diffLayout", scope: "user" }, CHANNEL, 0)).toEqual({ key: "diffLayout", scope: "user" });
  });

  it("rejects a write with no key, an unknown layer or a blank project", () => {
    for (const bad of [undefined, "diffLayout", { scope: "user" }, { key: "diffLayout", scope: "default" }, { key: "diffLayout", scope: "project", projectId: " " }]) {
      expect(() => setConfigValueInput(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });

  it("accepts each kind of file target and nothing else", () => {
    expect(configFileTarget({ kind: "keybindings" }, CHANNEL, 0)).toEqual({ kind: "keybindings" });
    expect(configFileTarget({ kind: "settings", scope: "local", projectId: "proj_1" }, CHANNEL, 0)).toEqual({ kind: "settings", scope: "local", projectId: "proj_1" });
    expect(configFileTarget({ kind: "folder", folder: "commands", scope: "user" }, CHANNEL, 0)).toEqual({ kind: "folder", folder: "commands", scope: "user" });
    for (const bad of [{ kind: "shell" }, { kind: "folder", folder: "../etc", scope: "user" }, { kind: "folder", folder: "commands", scope: "local" }, { kind: "settings", scope: "everyone" }]) {
      expect(() => configFileTarget(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });

  it("accepts a command to expand and nothing that is not one", () => {
    expect(commandExpandInput({ projectId: "proj_1", sessionId: "ses_1", text: "/review 12" }, CHANNEL, 0)).toEqual({ projectId: "proj_1", sessionId: "ses_1", text: "/review 12" });
    for (const bad of [undefined, { text: "/review" }, { projectId: "proj_1", text: "review" }, { projectId: "proj_1", text: "/x", sessionId: "" }]) {
      expect(() => commandExpandInput(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });

  it("restarts into or out of safe mode only on an explicit yes or no", () => {
    expect(appRestartInput({ safeMode: true }, CHANNEL, 0)).toEqual({ safeMode: true });
    expect(appRestartInput({ safeMode: false, extra: 1 }, CHANNEL, 0)).toEqual({ safeMode: false });
    for (const bad of [undefined, true, {}, { safeMode: "true" }, { safeMode: 1 }]) {
      expect(() => appRestartInput(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });
});

describe("permission rule edits", () => {
  it("passes an add or remove to your own files and nothing else", () => {
    expect(permissionRuleEdit({ op: "add", list: "allow", rule: "execute(pnpm test *)", scope: "local", projectId: "proj_1" }, CHANNEL, 0))
      .toEqual({ op: "add", list: "allow", rule: "execute(pnpm test *)", scope: "local", projectId: "proj_1" });
    for (const bad of [
      { op: "replace", list: "allow", rule: "edit", scope: "user" },
      { op: "add", list: "always", rule: "edit", scope: "user" },
      { op: "add", list: "allow", rule: "edit", scope: "project", projectId: "proj_1" },
      { op: "add", list: "allow", rule: " ", scope: "user" },
      { op: "add", list: "allow", rule: "edit", scope: "local" },
    ]) expect(() => permissionRuleEdit(bad, CHANNEL, 0)).toThrow(CHANNEL);
  });
});

describe("keybinding and theme import inputs", () => {
  it("accepts each keybinding edit and keeps only its fields", () => {
    expect(keybindingEdit({ op: "bind", action: "toggle-sidebar", context: "global", sequence: "cmd+e", extra: 1 }, CHANNEL, 0))
      .toEqual({ op: "bind", action: "toggle-sidebar", context: "global", sequence: "cmd+e" });
    expect(keybindingEdit({ op: "unbind", context: "composer", sequence: "alt+r" }, CHANNEL, 0)).toEqual({ op: "unbind", context: "composer", sequence: "alt+r" });
    expect(keybindingEdit({ op: "reset", action: "x", context: "panel" }, CHANNEL, 0)).toEqual({ op: "reset", action: "x", context: "panel" });
    for (const bad of [null, { op: "bind", context: "global", sequence: "cmd+e" }, { op: "unbind", context: "window", sequence: "x" }, { op: "delete", context: "global" }, { op: "bind", action: "a".repeat(201), context: "global", sequence: "x" }]) {
      expect(() => keybindingEdit(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });

  it("accepts a share string or a file pick, never a path", () => {
    expect(themeImportInput({ from: "file", path: "/etc/passwd" }, CHANNEL, 0)).toEqual({ from: "file" });
    expect(themeImportInput({ from: "share", text: "capsule-theme:abc" }, CHANNEL, 0)).toEqual({ from: "share", text: "capsule-theme:abc" });
    for (const bad of [{ from: "share", text: "" }, { from: "share", text: "x".repeat(33 * 1024) }, { from: "url", text: "https://x" }]) {
      expect(() => themeImportInput(bad, CHANNEL, 0)).toThrow(CHANNEL);
    }
  });
});

describe("MCP and profile arguments", () => {
  it("takes a server name, a switch with where it applies, and a profile to create or copy", () => {
    expect(mcpTestInput({ name: "docs", projectId: "p" }, "mcpTest", 0)).toEqual({ name: "docs", projectId: "p" });
    expect(() => mcpTestInput({ name: "../x" }, "mcpTest", 0)).toThrow(/MCP server name/);
    expect(mcpEnabledInput({ name: "docs", enabled: false, where: "project", projectId: "p" }, "mcpSetEnabled", 0)).toEqual({ name: "docs", enabled: false, where: "project", projectId: "p" });
    expect(() => mcpEnabledInput({ name: "docs", enabled: false, where: "project" }, "mcpSetEnabled", 0)).toThrow(/needs a projectId/);
    expect(profileCreateInput({ scope: "user", from: "reviewer" }, "profilesCreate", 0)).toEqual({ scope: "user", from: "reviewer" });
    expect(() => profileCreateInput({ scope: "user", from: "../x" }, "profilesCreate", 0)).toThrow(/profile id/);
    expect(configFileTarget({ kind: "resource", folder: "profiles", scope: "user", name: "team:reviewer" }, "configOpenFile", 0)).toEqual({ kind: "resource", folder: "profiles", scope: "user", name: "team:reviewer" });
    expect(() => configFileTarget({ kind: "resource", folder: "profiles", scope: "user", name: "../../etc" }, "configOpenFile", 0)).toThrow(/profile or style id/);
  });
});

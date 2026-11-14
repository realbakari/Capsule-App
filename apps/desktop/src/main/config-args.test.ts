import { describe, expect, it } from "vitest";
import { appRestartInput, commandExpandInput, configFileTarget, permissionRuleEdit, setConfigValueInput } from "./config-args.js";

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

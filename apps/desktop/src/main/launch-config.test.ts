import path from "node:path";
import { describe, expect, it } from "vitest";
import { configDirFor, relaunchArgs, safeModeFromArgs } from "./launch-config.js";

describe("safe mode", () => {
  it("starts from the flag or, for a dev run, the environment", () => {
    expect(safeModeFromArgs(["Capsule", "--safe-mode"])).toBe(true);
    expect(safeModeFromArgs(["electron", "."], { CAPSULE_SAFE_MODE: "1" })).toBe(true);
    expect(safeModeFromArgs(["electron", "."], { CAPSULE_SAFE_MODE: "0" })).toBe(false);
    expect(safeModeFromArgs(["Capsule", "--safe-modeish"])).toBe(false);
  });

  it("relaunches into and out of it, keeping every other argument", () => {
    expect(relaunchArgs(["electron", ".", "--remote"], true)).toEqual([".", "--remote", "--safe-mode"]);
    expect(relaunchArgs(["electron", ".", "--safe-mode", "--remote"], false)).toEqual([".", "--remote"]);
    expect(relaunchArgs(["Capsule", "--safe-mode"], true)).toEqual(["--safe-mode"]);
  });
});

describe("settings folder", () => {
  const home = path.join(path.sep, "Users", "fixture");
  const userData = path.join(path.sep, "tmp", "profile", "state");

  it("is ~/.capsule for the real profile", () => {
    expect(configDirFor({ env: {}, home, userData, ownProfile: false })).toBe(path.join(home, ".capsule"));
  });

  it("stays inside a profile launched with its own data folder", () => {
    expect(configDirFor({ env: {}, home, userData, ownProfile: true })).toBe(path.join(userData, "capsule-home"));
  });

  it("follows CAPSULE_CONFIG_DIR over both", () => {
    const chosen = path.join(path.sep, "tmp", "dotfiles", "capsule");
    expect(configDirFor({ env: { CAPSULE_CONFIG_DIR: chosen }, home, userData, ownProfile: true })).toBe(chosen);
  });
});

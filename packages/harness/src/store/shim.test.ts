import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { posixShim, shimFileName, windowsShim } from "./shim.js";

describe("posixShim", () => {
  it("execs the target with the agent's env, dropping unsafe keys", () => {
    expect(posixShim({ target: "/agents/kilo/7.8.27/kilo", env: { KILO_MODE: "acp", PATH: "/evil", DYLD_INSERT_LIBRARIES: "x", "BAD-KEY": "y" } })).toBe(
      ["#!/bin/sh", "export KILO_MODE='acp'", "exec '/agents/kilo/7.8.27/kilo' \"$@\"", ""].join("\n"),
    );
  });

  it("quotes values so the shell runs nothing from them", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "capsule-shim-"));
    try {
      mkdirSync(path.join(dir, "it's here"));
      const target = path.join(dir, "it's here", "agent");
      writeFileSync(target, '#!/bin/sh\nprintf "%s|%s|%s" "$WEIRD" "$1" "$2"\n');
      chmodSync(target, 0o755);
      const shim = path.join(dir, "shim");
      const value = "a'b $(touch pwned) `x` \"q\" \\ $HOME\nline";
      writeFileSync(shim, posixShim({ target, env: { WEIRD: value } }));
      chmodSync(shim, 0o755);
      const result = spawnSync(shim, ["one two", "$three"], { encoding: "utf8", cwd: dir });
      expect(result.stdout).toBe(`${value}|one two|$three`);
      expect(readdirSync(dir)).not.toContain("pwned");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the node folder after the user's PATH", () => {
    expect(posixShim({ target: "/t", env: {}, pathAfter: "/opt/node/bin" })).toContain(`export PATH="$PATH":'/opt/node/bin'`);
  });
});

describe("windowsShim", () => {
  it("sets the env and forwards every argument", () => {
    expect(windowsShim({ target: "C:\\agents\\kimi\\1.52.0\\kimi.exe", env: { MODE: "100%", PATH: "x", Q: 'say "hi"' }, pathAfter: "C:\\node" })).toBe(
      ["@echo off", 'set "MODE=100%%"', 'set "PATH=%PATH%;C:\\node"', '"C:\\agents\\kimi\\1.52.0\\kimi.exe" %*', ""].join("\r\n"),
    );
  });

  it("is a .cmd file on Windows only", () => {
    expect(shimFileName("kimi", "win32")).toBe("kimi.cmd");
    expect(shimFileName("kimi", "darwin")).toBe("kimi");
  });
});

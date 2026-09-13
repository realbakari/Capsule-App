import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { firstExecutablePath } from "./binary-path.js";
import { clearBinaryCache, whichBinary } from "./index.js";

it("prefers a Windows launcher over the accompanying Unix shim", () => {
  const paths = "C:\\npm\\agent\r\nC:\\npm\\agent.cmd\r\nC:\\other\\agent.exe\r\n";
  expect(firstExecutablePath(paths, "win32")).toBe("C:\\npm\\agent.cmd");
  expect(firstExecutablePath("\n/usr/local/bin/agent\n/usr/bin/agent\n", "darwin")).toBe("/usr/local/bin/agent");
  expect(firstExecutablePath("\r\n", "win32")).toBeUndefined();
});

it.skipIf(process.platform !== "win32")("discovers a native npm shim on PATH without requiring a Unix shell", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule lookup "));
  const name = `capsule-fixture-${process.pid}`;
  const launcher = path.join(directory, `${name}.cmd`);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  try {
    writeFileSync(path.join(directory, name), "#!/bin/sh\nexit 97\n");
    writeFileSync(launcher, "@exit /b 0\r\n");
    vi.stubEnv(pathKey, `${directory}${path.delimiter}${process.env[pathKey] ?? ""}`);
    clearBinaryCache();
    const found = whichBinary([name]);
    expect(found).toBeDefined();
    expect(realpathSync.native(found!)).toBe(realpathSync.native(launcher));
  } finally {
    vi.unstubAllEnvs();
    clearBinaryCache();
    rmSync(directory, { recursive: true, force: true });
  }
});

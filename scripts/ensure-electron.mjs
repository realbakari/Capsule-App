#!/usr/bin/env node
/**
 * electron-vite throws "Electron uninstall" when path.txt is missing or empty,
 * which happens when pnpm skips electron's postinstall. A half-extracted dist
 * fails later and less clearly: the binary is there and is not an executable.
 * This repairs both, then prints the path.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { electronPackageDir, resolveElectronBinary, runtimeProblems } from "./electron-path.mjs";

function installElectron(electronDir) {
  const installer = path.join(electronDir, "install.js");
  if (!fs.existsSync(installer)) {
    throw new Error(`electron install.js is missing at ${installer}`);
  }
  const result = spawnSync(process.execPath, [installer], {
    cwd: electronDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`electron install.js exited with ${result.status ?? "unknown"}`);
  }
}

const electronDir = electronPackageDir();
const problems = runtimeProblems(electronDir);
if (problems.length > 0) {
  console.log(`Electron runtime needs repair:\n${problems.map((line) => `- ${line}`).join("\n")}`);
  // A partial dist is what produced the problems; reinstalling over it keeps
  // whatever was already wrong.
  fs.rmSync(path.join(electronDir, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(electronDir, "path.txt"), { force: true });
  installElectron(electronDir);
}

const resolved = resolveElectronBinary(electronDir);
process.env.ELECTRON_EXEC_PATH = resolved;
console.log(`Electron ready: ${resolved}`);

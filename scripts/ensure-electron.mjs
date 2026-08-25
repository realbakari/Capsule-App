#!/usr/bin/env node
/**
 * electron-vite throws "Electron uninstall" when path.txt is missing or empty.
 * That happens when pnpm skips electron's postinstall. This script finds the
 * electron package, runs its installer if needed, and prints the binary path.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const searchRoots = [
  path.join(root, "apps/desktop"),
  root,
];

function resolveElectronPackage() {
  const errors = [];
  for (const from of searchRoots) {
    try {
      const require = createRequire(path.join(from, "package.json"));
      const pkgJson = require.resolve("electron/package.json");
      return path.dirname(pkgJson);
    } catch (error) {
      errors.push(`${from}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not resolve the electron package.\n${errors.join("\n")}`);
}

function readExecutablePath(electronDir) {
  const pathFile = path.join(electronDir, "path.txt");
  if (!fs.existsSync(pathFile)) return "";
  return fs.readFileSync(pathFile, "utf8").trim();
}

function binaryPath(electronDir, executablePath) {
  return path.join(electronDir, "dist", executablePath);
}

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

const electronDir = resolveElectronPackage();
let executablePath = readExecutablePath(electronDir);
let resolved = executablePath ? binaryPath(electronDir, executablePath) : "";

if (!executablePath || !fs.existsSync(resolved)) {
  console.log("Electron binary is missing; running electron/install.js…");
  installElectron(electronDir);
  executablePath = readExecutablePath(electronDir);
  resolved = executablePath ? binaryPath(electronDir, executablePath) : "";
}

if (!executablePath || !fs.existsSync(resolved)) {
  throw new Error(
    `Electron failed to install. Expected a binary at ${resolved || path.join(electronDir, "dist")}. Try: pnpm rebuild electron`,
  );
}

process.env.ELECTRON_EXEC_PATH = resolved;
console.log(`Electron ready: ${resolved}`);

#!/usr/bin/env node
/**
 * better-sqlite3 must be compiled for Electron's Node ABI, not the host Node.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");

if (process.env.VERCEL) {
  console.log("Running in Vercel CI environment; skipping desktop native module verification probe");
  process.exit(0);
}

const requireFromDesktop = createRequire(path.join(desktop, "package.json"));
const electronDir = path.dirname(requireFromDesktop.resolve("electron/package.json"));
const electronVersion = requireFromDesktop("electron/package.json").version;
const stampPath = path.join(electronDir, ".capsule-native-abi");
const executablePath = fs.readFileSync(path.join(electronDir, "path.txt"), "utf8").trim();
const electronBin = path.join(electronDir, "dist", executablePath);

function probe() {
  const result = spawnSync(
    electronBin,
    [
      "-e",
      "try { require('better-sqlite3'); console.log(process.versions.modules); process.exit(0); } catch (e) { console.error(e.message); process.exit(2); }",
    ],
    {
      cwd: desktop,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

function rebuild() {
  console.log("Rebuilding better-sqlite3 for Electron", electronVersion);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "electron-rebuild",
      "--force",
      "--only",
      "better-sqlite3",
      "--version",
      electronVersion,
      "--module-dir",
      desktop,
    ],
    {
      cwd: desktop,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error("electron-rebuild failed for better-sqlite3");
  }
}

const stamped = fs.existsSync(stampPath)
  ? fs.readFileSync(stampPath, "utf8").trim()
  : "";
if (stamped !== electronVersion || !probe()) {
  rebuild();
  if (!probe()) {
    throw new Error("better-sqlite3 still does not load inside Electron after rebuild");
  }
  fs.writeFileSync(stampPath, electronVersion);
}

console.log("Native modules match Electron", electronVersion);

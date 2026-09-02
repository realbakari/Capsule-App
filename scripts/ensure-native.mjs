#!/usr/bin/env node
/**
 * Native modules must be compiled for Electron's Node ABI, not the host Node.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  electronPackageDir,
  electronVersion as electronVersionOf,
  resolveElectronBinary,
} from "./electron-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");

if (process.env.VERCEL) {
  console.log("Running in Vercel CI environment; skipping desktop native module verification probe");
  process.exit(0);
}

const requireFromDesktop = createRequire(path.join(desktop, "package.json"));
const electronDir = electronPackageDir();
const electronVersion = electronVersionOf(electronDir);
const stampPath = path.join(electronDir, ".capsule-native-abi");
const electronBin = resolveElectronBinary(electronDir);

const NATIVE_MODULES = ["better-sqlite3", "node-pty"];

function probe() {
  const requires = NATIVE_MODULES.map((name) => `require('${name}');`).join(" ");
  const result = spawnSync(
    electronBin,
    [
      "-e",
      `try { ${requires} console.log(process.versions.modules); process.exit(0); } catch (e) { console.error(e.message); process.exit(2); }`,
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
  console.log(`Rebuilding ${NATIVE_MODULES.join(", ")} for Electron`, electronVersion);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "electron-rebuild",
      "--force",
      "--only",
      NATIVE_MODULES.join(","),
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
    throw new Error(`electron-rebuild failed for ${NATIVE_MODULES.join(", ")}`);
  }
}

/*
 * node-pty forks through a helper binary it ships prebuilt. The package's own
 * install script is what marks it executable, and a store that skips install
 * scripts leaves it at 0644 — every terminal then dies with "posix_spawnp
 * failed" before the shell starts.
 */
function ensureSpawnHelperIsExecutable() {
  let ptyDir;
  try {
    ptyDir = path.dirname(requireFromDesktop.resolve("node-pty/package.json"));
  } catch {
    return;
  }
  const helper = path.join(ptyDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (!fs.existsSync(helper)) return;
  const mode = fs.statSync(helper).mode;
  if (mode & 0o111) return;
  fs.chmodSync(helper, 0o755);
  console.log("Marked node-pty's spawn-helper executable");
}

ensureSpawnHelperIsExecutable();

const stamped = fs.existsSync(stampPath)
  ? fs.readFileSync(stampPath, "utf8").trim()
  : "";
if (stamped !== electronVersion || !probe()) {
  rebuild();
  if (!probe()) {
    throw new Error(`${NATIVE_MODULES.join(" or ")} still does not load inside Electron after rebuild`);
  }
  fs.writeFileSync(stampPath, electronVersion);
}

console.log("Native modules match Electron", electronVersion);

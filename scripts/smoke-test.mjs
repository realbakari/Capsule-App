#!/usr/bin/env node
/**
 * Boots the built app and fails if it dies on the way up.
 *
 * Nothing else in the gate runs the app. Typecheck, lint, the unit tests and
 * the production build all passed on a main bundle that could not load
 * node-pty's native binding, and the first thing that noticed was a person
 * opening the window. This is the cheapest check that would have caught it.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveElectronBinary } from "./electron-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const mainBundle = path.join(desktop, "out/main/index.js");
const BOOT_WINDOW_MS = 12_000;

/*
 * Things that mean the app is broken, not that the machine is offline. A
 * Gateway that is not running, a missing API key or a failed update check are
 * all normal on a developer's laptop and must not fail the build.
 */
const FATAL_PATTERNS = [
  "App threw an error during load",
  "A JavaScript error occurred in the main process",
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Failed to load native module",
  "Refused to execute",
  "Refused to load",
  "Uncaught Exception",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

/*
 * The check that matters. A list of failure strings is always one phrasing
 * behind reality; the app printing this means it reached a loaded window,
 * whatever else appeared on the way.
 */
const READY_MARKER = /capsule: window ready \((\d+)\)/u;

if (!fs.existsSync(mainBundle)) {
  console.error(`No build to smoke test at ${mainBundle}. Run: pnpm build`);
  process.exit(1);
}

const electron = resolveElectronBinary();
// Its own user data directory: a smoke test must not touch the database, the
// settings or the window state of the app you actually use.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-smoke-"));

const child = spawn(electron, [desktop, `--user-data-dir=${userData}`], {
  cwd: desktop,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", CAPSULE_SMOKE_TEST: "1" },
});

let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
}, BOOT_WINDOW_MS);

child.on("error", (error) => {
  clearTimeout(timer);
  console.error(`Could not launch Electron: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  clearTimeout(timer);
  fs.rmSync(userData, { recursive: true, force: true });

  const failures = FATAL_PATTERNS.filter((pattern) => output.includes(pattern));
  const ready = READY_MARKER.exec(output);
  if (!ready) failures.push("the window never finished loading");
  else if (ready[1] !== "1") failures.push(`the app opened ${ready[1]} windows, not 1`);
  // Exiting on its own before the window is up is a failure too, however
  // quietly it happened.
  if (!timedOut && code !== 0) failures.push(`exited with code ${code}`);

  if (failures.length > 0) {
    console.error("Smoke test failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    console.error(`\n${output}`);
    process.exit(1);
  }
  console.log("Smoke test passed: the app started and loaded one window.");
  process.exit(0);
});

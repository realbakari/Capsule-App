#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");

await import("./ensure-electron.mjs");
await import("./ensure-native.mjs");

// --watch rebuilds and restarts on main/preload changes. Without it only the
// renderer hot-reloads, so edits to the engine, the OpenClaw adapter, or IPC
// stay invisible in a running app — the window keeps updating while the
// backend silently runs whatever was built at launch.
const child = spawn("pnpm", ["exec", "electron-vite", "dev", "--watch"], {
  cwd: desktop,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

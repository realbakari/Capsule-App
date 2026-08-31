#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");

await import("./ensure-electron.mjs");
await import("./ensure-native.mjs");

// electron-vite only exposes VITE_-prefixed vars, and only to the renderer, so
// nothing in .env.local reaches the main process where the engine runs. The
// skills.sh token lives there after `vercel env pull` and rotates every ~12
// hours, which would otherwise mean re-pasting it into Settings twice a day.
// Existing environment wins, and this is dev only — the packaged app reads the
// Keychain instead.
function loadDotEnvLocal() {
  let raw;
  try {
    raw = readFileSync(path.join(root, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    if (process.env[key] !== undefined) continue;
    const value = rest.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (value) process.env[key] = value;
  }
}

loadDotEnvLocal();

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

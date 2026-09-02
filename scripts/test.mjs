#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("./ensure-electron.mjs");
const { resolveElectronBinary } = await import("./electron-path.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBin = resolveElectronBinary();
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");

const child = spawn(electronBin, [vitest, "run", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

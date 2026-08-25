#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("./ensure-electron.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const requireFromDesktop = createRequire(path.join(desktop, "package.json"));
const electronDir = path.dirname(requireFromDesktop.resolve("electron/package.json"));
const executablePath = fs.readFileSync(path.join(electronDir, "path.txt"), "utf8").trim();
const electronBin = path.join(electronDir, "dist", executablePath);
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

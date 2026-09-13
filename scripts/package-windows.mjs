#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Build the Windows x64 installer on a native Windows x64 machine.");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args, cwd = root) => {
  // Arguments here are fixed build commands, never user-entered commands.
  const result = spawnSync("pnpm", args, { cwd, stdio: "inherit", shell: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows build failed: pnpm ${args.join(" ")}`);
};
run(["build"]);
run(["exec", "electron-builder", "--win", "nsis", "--x64", "--publish", "never"], path.join(root, "apps/desktop"));

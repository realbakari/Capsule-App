#!/usr/bin/env node
/**
 * Where Electron's binary is, and whether it is intact.
 *
 * Three scripts used to work this out for themselves by reading path.txt and
 * joining it onto dist/. That is fine until the install is half-finished: a
 * path.txt pointing at a file that exists but is not a Mach-O binary passes an
 * existsSync check and then fails at launch with nothing useful to say.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");

export function electronPackageDir() {
  const errors = [];
  for (const from of [desktop, root]) {
    try {
      return path.dirname(createRequire(path.join(from, "package.json")).resolve("electron/package.json"));
    } catch (error) {
      errors.push(`${from}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not resolve the electron package.\n${errors.join("\n")}`);
}

export function electronVersion(dir = electronPackageDir()) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
}

function executableName(dir) {
  const pathFile = path.join(dir, "path.txt");
  return fs.existsSync(pathFile) ? fs.readFileSync(pathFile, "utf8").trim() : "";
}

/** Files that have to exist for Electron to start, not just the executable. */
export function runtimeFiles(dir) {
  const executable = executableName(dir);
  if (!executable) return [];
  const files = [path.join(dir, "dist", executable)];
  if (process.platform === "darwin") {
    const app = path.join(dir, "dist", "Electron.app", "Contents");
    files.push(
      path.join(app, "Info.plist"),
      path.join(app, "Frameworks", "Electron Framework.framework", "Electron Framework"),
    );
  }
  return files;
}

function isMachO(file) {
  if (process.platform !== "darwin") return true;
  const result = spawnSync("file", ["-b", file], { encoding: "utf8" });
  return result.status === 0 && result.stdout.includes("Mach-O");
}

/**
 * What is wrong with the installed runtime, if anything. A partial download
 * leaves files that exist and are not executables, which is why this looks at
 * what they are rather than only whether they are there.
 */
export function runtimeProblems(dir = electronPackageDir()) {
  if (!executableName(dir)) return ["path.txt is missing or empty"];
  const problems = [];
  for (const file of runtimeFiles(dir)) {
    if (!fs.existsSync(file)) problems.push(`missing ${file}`);
    else if (file.endsWith(".plist")) continue;
    else if (!isMachO(file)) problems.push(`not a Mach-O binary: ${file}`);
  }
  return problems;
}

/** The binary path. Throws with the reason when the install is unusable. */
export function resolveElectronBinary(dir = electronPackageDir()) {
  const problems = runtimeProblems(dir);
  if (problems.length > 0) {
    throw new Error(
      `Electron's runtime is incomplete:\n${problems.map((line) => `- ${line}`).join("\n")}\nTry: pnpm rebuild electron`,
    );
  }
  return path.join(dir, "dist", executableName(dir));
}

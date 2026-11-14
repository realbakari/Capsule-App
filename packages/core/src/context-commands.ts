import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { commandOutput, detectCheckCommand, type CheckCommand, type CommandResult, type ProjectAction } from "@capsule/shared";
import { runInDirectory } from "@capsule/terminal";

export const COMPOSER_COMMAND_TIMEOUT_MS = 60_000;
export const DIAGNOSTICS_TIMEOUT_MS = 180_000;
const LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "package-lock.json"];

/** Reads package.json and lockfile names only; nothing runs here. */
export function findCheckCommand(cwd: string, actions: readonly ProjectAction[]): CheckCommand | undefined {
  let packageJson: string | undefined;
  try { packageJson = readFileSync(path.join(cwd, "package.json"), "utf8").slice(0, 512 * 1024); } catch { packageJson = undefined; }
  return detectCheckCommand({ actions, packageJson, lockfiles: LOCKFILES.filter((file) => existsSync(path.join(cwd, file))) });
}

/** Runs one command in the folder under its activity lease and returns exit code and the tail of its output. */
export async function runContextCommand(cwd: string, command: string, timeoutMs: number, lease: () => () => void): Promise<CommandResult> {
  const text = command.trim();
  if (!text) throw new Error("Type a command after !.");
  if (text.length > 4_000 || text.includes("\0")) throw new Error("Commands are limited to 4,000 characters.");
  const release = lease();
  const started = Date.now();
  try {
    const result = await runInDirectory(cwd, text, timeoutMs);
    return { command: text, exitCode: result.code, ...commandOutput(result.stdout, result.stderr), durationMs: Date.now() - started };
  } finally {
    release();
  }
}

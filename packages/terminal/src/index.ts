import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function terminalAppleScript(app: "Terminal" | "iTerm"): string {
  if (app === "iTerm") {
    return [
      "on run argv",
      "set thePath to item 1 of argv",
      'tell application "iTerm"',
      "activate",
      "create window with default profile",
      "tell current session of current window",
      "write text (\"cd \" & quoted form of thePath)",
      "end tell",
      "end tell",
      "end run",
    ].join("\n");
  }
  return [
    "on run argv",
    "set thePath to item 1 of argv",
    'tell application "Terminal"',
    "activate",
    "do script (\"cd \" & quoted form of thePath)",
    "end tell",
    "end run",
  ].join("\n");
}

function preferredMacTerminal(): "Terminal" | "iTerm" {
  if (existsSync("/Applications/iTerm.app")) return "iTerm";
  if (existsSync("/Applications/iTerm 2.app")) return "iTerm";
  return "Terminal";
}

function runOsascript(script: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script, cwd], { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk as Buffer));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `osascript exited ${code}`));
    });
  });
}

export async function openNativeTerminal(cwd: string): Promise<void> {
  if (!cwd) throw new Error("Project has no working directory");
  if (!existsSync(cwd)) throw new Error(`Folder does not exist: ${cwd}`);
  if (process.platform !== "darwin") {
    throw new Error("Opening Terminal is available on macOS");
  }
  const app = preferredMacTerminal();
  await runOsascript(terminalAppleScript(app), cwd);
}

export function runInDirectory(
  cwd: string,
  command: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  const text = command.trim();
  if (!text) throw new Error("Command is empty");
  if (!cwd || !existsSync(cwd)) throw new Error("Working directory is missing");
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", text], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk as Buffer));
    child.stderr.on("data", (chunk) => stderr.push(chunk as Buffer));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 1,
      });
    });
  });
}

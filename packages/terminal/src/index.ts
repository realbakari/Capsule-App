import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { spawn as spawnPty } from "node-pty";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ManagedCommand {
  pid?: number;
  stop: () => void;
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

export function startInDirectory(
  cwd: string,
  command: string,
  handlers: {
    onOutput: (text: string) => void;
    onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
    onError: (error: Error) => void;
  },
): ManagedCommand {
  const text = command.trim();
  if (!text) throw new Error("Command is empty");
  if (!cwd || !existsSync(cwd)) throw new Error("Working directory is missing");
  const child = spawn("/bin/zsh", ["-lc", text], {
    cwd,
    env: process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => handlers.onOutput(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => handlers.onOutput(chunk.toString("utf8")));
  child.on("error", handlers.onError);
  child.on("close", handlers.onExit);
  return {
    pid: child.pid,
    stop: () => {
      if (child.killed) return;
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // The shell may already have exited; fall back to the child handle.
        }
      }
      child.kill("SIGTERM");
    },
  };
}

/**
 * A shell running on a pseudo-terminal, for the terminal panel inside Capsule.
 *
 * `runInDirectory` and `startInDirectory` above run one command and hand back
 * its output — enough for a project action, useless for a shell session, which
 * needs a TTY to draw a prompt, run an editor, or read a keystroke.
 */
export interface PtySession {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

/** The shell to open. The login shell if the OS reports one, else zsh. */
export function preferredShell(env: NodeJS.ProcessEnv = process.env): string {
  const shell = env.SHELL?.trim();
  return shell && existsSync(shell) ? shell : "/bin/zsh";
}

export function startPty(
  input: { cwd: string; cols?: number; rows?: number; shell?: string },
  handlers: { onData: (data: string) => void; onExit: (code: number, signal?: number) => void },
): PtySession {
  if (!input.cwd || !existsSync(input.cwd)) throw new Error("Working directory is missing");
  const shell = input.shell ?? preferredShell();
  const child = spawnPty(shell, ["-l"], {
    name: "xterm-256color",
    cols: Math.max(2, input.cols ?? 80),
    rows: Math.max(1, input.rows ?? 24),
    cwd: input.cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });
  child.onData(handlers.onData);
  child.onExit(({ exitCode, signal }) => handlers.onExit(exitCode, signal));
  return {
    pid: child.pid,
    write: (data) => child.write(data),
    resize: (cols, rows) => {
      // A zero column count is what a hidden pane reports; the shell treats it
      // as an error and stops redrawing.
      child.resize(Math.max(2, cols), Math.max(1, rows));
    },
    kill: () => {
      try {
        child.kill();
      } catch {
        // Already gone: the exit handler has run or the shell was killed.
      }
    },
  };
}

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { spawn as spawnPty } from "node-pty";
import { spawnCommand, stopChild } from "@capsule/process";
import { commandShell, interactiveShellArgs, windowsPowerShell } from "./shell.js";

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
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(windowsPowerShell(), ["-NoLogo", "-NoExit"], { cwd, detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    return;
  }
  if (process.platform !== "darwin") throw new Error("Opening an external terminal is supported on macOS and Windows.");
  const app = preferredMacTerminal();
  await runOsascript(terminalAppleScript(app), cwd);
}

/**
 * The last `cap` characters of a stream, without recopying the buffer.
 *
 * Appending with `text = (text + chunk).slice(-cap)` re-slices everything kept
 * on every chunk, so the work grows with output times the cap rather than with
 * output. This keeps the chunks and drops whole ones off the front, joining
 * once when the command has finished. Measured on 400KB arriving in 20,000
 * writes: 14.2ms becomes 2.1ms, with identical output. A check that prints
 * more, and this runs in the main process, pays proportionally more.
 */
export function outputTail(cap: number) {
  const parts: string[] = [];
  let length = 0;
  return {
    push(chunk: string): void {
      parts.push(chunk);
      length += chunk.length;
      /*
       * Drop a chunk only while what remains still covers the cap, so the
       * tail is never short. Dropping releases the reference, which is the
       * point: the evicted text must not stay reachable.
       */
      while (parts.length > 1 && length - (parts[0]?.length ?? 0) >= cap) {
        length -= parts.shift()?.length ?? 0;
      }
    },
    read(): string {
      const text = parts.join("");
      return text.length > cap ? text.slice(-cap) : text;
    },
  };
}

export function runInDirectory(
  cwd: string,
  command: string,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const text = command.trim();
  if (!text) throw new Error("Command is empty");
  if (!cwd || !existsSync(cwd)) throw new Error("Working directory is missing");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Check cancelled.")); return; }
    const shell = commandShell(text);
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout = outputTail(20_000);
    const stderr = outputTail(20_000);
    let failure: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => {
      stopChild(child, kind, true);
    };
    const stop = (reason: string) => {
      if (failure) return;
      failure = reason;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1000);
    };
    const cancel = () => stop("Check cancelled.");
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => stop(`Command timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", cancel); };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) { reject(new Error(failure)); return; }
      resolve({
        stdout: stdout.read(),
        stderr: stderr.read(),
        code: code ?? 1,
      });
    });
  });
}

export interface CappedRun {
  /** Standard output and error in the order they arrived, cut at the byte cap. */
  output: string;
  /** Null when the command was stopped at the time limit. */
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * One command whose output becomes text someone reads, such as a prompt: the
 * first `maxBytes` of both streams together, and whatever it printed before
 * the time limit rather than an error in its place.
 */
export function runCapped(cwd: string, command: string, limits: { timeoutMs: number; maxBytes: number }): Promise<CappedRun> {
  if (!cwd || !existsSync(cwd)) return Promise.reject(new Error("Working directory is missing"));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const shell = commandShell(command);
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const collect = (chunk: Buffer) => {
      if (bytes >= limits.maxBytes) { truncated = true; return; }
      const kept = chunk.subarray(0, limits.maxBytes - bytes);
      if (kept.length < chunk.length) truncated = true;
      chunks.push(kept);
      bytes += kept.length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child, "SIGTERM", true);
      killTimer = setTimeout(() => stopChild(child, "SIGKILL", true), 1000);
    }, limits.timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), code: timedOut ? null : code ?? 1, timedOut, truncated, durationMs: Date.now() - started });
    });
  });
}

export interface InputRun {
  stdout: string;
  stderr: string;
  /** Null when the command was stopped at the time limit. */
  code: number | null;
  timedOut: boolean;
  durationMs: number;
}

/**
 * One command fed `input` on stdin, with extra environment, its streams kept
 * apart and each cut at `maxBytes`. A hook reads JSON this way and answers
 * on stdout, with its reason on stderr.
 */
export function runWithInput(
  cwd: string,
  command: string,
  options: { input: string; env?: Record<string, string>; timeoutMs: number; maxBytes: number },
): Promise<InputRun> {
  if (!cwd || !existsSync(cwd)) return Promise.reject(new Error("Working directory is missing"));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const shell = commandShell(command);
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const collected = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const sizes = { stdout: 0, stderr: 0 };
    const collect = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const room = options.maxBytes - sizes[stream];
      if (room <= 0) return;
      const kept = chunk.subarray(0, room);
      collected[stream].push(kept);
      sizes[stream] += kept.length;
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    // A command that never reads stdin closes it early; that is not a failure.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child, "SIGTERM", true);
      killTimer = setTimeout(() => stopChild(child, "SIGKILL", true), 1000);
    }, options.timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        stdout: Buffer.concat(collected.stdout).toString("utf8"),
        stderr: Buffer.concat(collected.stderr).toString("utf8"),
        code: timedOut ? null : code ?? 1,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * A program with its arguments, never through a shell, so a URL or a path
 * someone typed is one argument however it is written. Installing a plugin
 * runs `git` and `ditto` or `unzip` this way.
 */
export function runProgram(
  cwd: string,
  file: string,
  args: readonly string[],
  options: { env?: Record<string, string>; timeoutMs: number; maxBytes: number },
): Promise<Omit<InputRun, "durationMs">> {
  if (!cwd || !existsSync(cwd)) return Promise.reject(new Error("Working directory is missing"));
  return new Promise((resolve, reject) => {
    const child = spawnCommand(file, [...args], {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const out = { stdout: "", stderr: "" };
    const collect = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      if (out[stream].length < options.maxBytes) out[stream] += chunk.toString("utf8").slice(0, options.maxBytes - out[stream].length);
    };
    child.stdout?.on("data", collect("stdout"));
    child.stderr?.on("data", collect("stderr"));
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild(child, "SIGTERM", true);
      killTimer = setTimeout(() => stopChild(child, "SIGKILL", true), 1000);
    }, options.timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ ...out, code: timedOut ? null : code ?? 1, timedOut });
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
  const shell = commandShell(text);
  const child = spawn(shell.file, shell.args, {
    cwd,
    env: process.env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => handlers.onOutput(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => handlers.onOutput(chunk.toString("utf8")));
  let closed = false;
  let stopRequested = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { closed = true; clearTimeout(killTimer); };
  const signal = (value: NodeJS.Signals) => {
    if (closed) return;
    stopChild(child, value, true);
  };
  child.on("error", (error) => { cleanup(); handlers.onError(error); });
  child.on("close", (code, value) => { cleanup(); handlers.onExit(code, value); });
  return {
    pid: child.pid,
    stop: () => {
      if (closed || stopRequested) return;
      stopRequested = true;
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), 1000);
      killTimer.unref();
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
  pause: () => void;
  resume: () => void;
}

/** The shell to open. The login shell if the OS reports one, else zsh. */
export function preferredShell(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") return windowsPowerShell(env);
  const shell = env.SHELL?.trim();
  return shell && existsSync(shell) ? shell : process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

export function startPty(
  input: { cwd: string; cols?: number; rows?: number; shell?: string; },
  handlers: { onData: (data: string) => void; onExit: (code: number, signal?: number) => void; },
): PtySession {
  if (!input.cwd || !existsSync(input.cwd)) throw new Error("Working directory is missing");
  const shell = input.shell ?? preferredShell();
  const child = spawnPty(shell, interactiveShellArgs(shell), {
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
    pause: () => child.pause(),
    resume: () => child.resume(),
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

export { TerminalOutputFlow } from "./output-flow.js";

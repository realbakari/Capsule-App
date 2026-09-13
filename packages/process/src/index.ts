import { spawn, type ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";

// Handles PATH/PATHEXT and npm's .cmd shims without passing unescaped arguments
// through shell:true. Callers still own cwd, environment, output and lifetime.
export const spawnCommand = crossSpawn;
export const spawnCommandSync = crossSpawn.sync;

/** Only terminate a child captured at spawn time, never a process name. */
export function stopChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM", group = false): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // A .cmd wrapper owns the CLI beneath it. Killing just cmd.exe leaks the
    // agent. /T follows this captured PID's children; /F is needed for consoles.
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => { child.kill(); });
    return;
  }
  try {
    if (group) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* The owned child already exited. */ }
}

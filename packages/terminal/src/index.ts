import { spawn } from "node:child_process";

export function openNativeTerminal(cwd: string): void {
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", cwd], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  throw new Error("Native terminal opening is currently implemented for macOS");
}

import { execFile } from "node:child_process";

export interface RelayCredentials { url: string; privateKey: string }
export type RelayCommand = (connection: RelayCredentials, args: string[], signal: AbortSignal, input?: string) => Promise<unknown>;

/** Use the installed client's signing/authorization, not a second protocol implementation.
 * No shell, secret argv, inherited agent identity, or raw child errors in logs. */
export const runRelayCommand: RelayCommand = (connection, args, signal, input) => new Promise((resolve, reject) => {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.BUZZ_PRIVATE_KEY = connection.privateKey;
  const child = execFile(process.platform === "win32" ? "buzz.exe" : "buzz", ["--relay", connection.url, "--format", "json", ...args], {
    env, signal, timeout: 20_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: "utf8",
  }, (error, stdout) => {
    if (error) {
      const detail = error.code === "ENOENT" ? "Install the relay CLI (buzz) on this computer, then reopen Capsule."
        : error.code === 3 ? "The relay did not authorize this identity. Check its membership and key."
        : signal.aborted ? "The channel connection was closed."
        : "The relay command failed or timed out. Check the relay, membership, and CLI version. If you were posting, refresh before retrying to avoid a duplicate.";
      reject(new Error(detail));
      return;
    }
    try { resolve(JSON.parse(stdout)); }
    catch { reject(new Error("The relay CLI returned an unsupported response. Update the CLI and retry.")); }
  });
  child.stdin?.on("error", () => { /* The exit callback owns reporting; never log message content. */ });
  child.stdin?.end(input ?? "");
});

import path from "node:path";

export function windowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Project actions are shell programs; do not silently translate their syntax. */
export function commandShell(command: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") return {
    file: windowsPowerShell(),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `& {\n${command}\n}\nif (-not $?) { exit 1 }\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`],
  };
  return { file: platform === "darwin" ? "/bin/zsh" : "/bin/sh", args: ["-lc", command] };
}

export function interactiveShellArgs(shell: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return ["-l"];
  return /(?:powershell|pwsh)(?:\.exe)?$/iu.test(shell) ? ["-NoLogo"] : [];
}

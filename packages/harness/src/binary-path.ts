/** Prefer the native Windows launcher when npm also installs a Unix shim. */
export function firstExecutablePath(output: string, platform: NodeJS.Platform): string | undefined {
  const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (platform === "win32") {
    return candidates.find((candidate) => /\.(?:exe|com|cmd|bat)$/i.test(candidate)) ?? candidates[0];
  }
  return candidates[0];
}

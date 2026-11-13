import path from "node:path";

const SAFE_MODE_FLAG = "--safe-mode";

/**
 * Whether this launch reads no customization file. `CAPSULE_SAFE_MODE=1`
 * does the same for a dev run, where the launcher owns argv.
 */
export function safeModeFromArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): boolean {
  return argv.includes(SAFE_MODE_FLAG) || env.CAPSULE_SAFE_MODE === "1";
}

/** Arguments for a relaunch into, or out of, safe mode, keeping every other argument. */
export function relaunchArgs(argv: readonly string[], safeMode: boolean): string[] {
  const kept = argv.slice(1).filter((arg) => arg !== SAFE_MODE_FLAG);
  return safeMode ? [...kept, SAFE_MODE_FLAG] : kept;
}

/**
 * The user's settings folder: `CAPSULE_CONFIG_DIR`, else `~/.capsule`.
 *
 * A profile launched with its own `--user-data-dir` (a test, or a sandbox
 * seeded from the real database) gets a folder inside that profile instead,
 * so it never reads the developer's real settings or migrates into them.
 */
export function configDirFor(options: {
  env: Record<string, string | undefined>;
  home: string;
  userData: string;
  ownProfile: boolean;
}): string {
  if (options.env.CAPSULE_CONFIG_DIR) return path.resolve(options.env.CAPSULE_CONFIG_DIR);
  if (options.ownProfile) return path.join(options.userData, "capsule-home");
  return path.join(options.home, ".capsule");
}

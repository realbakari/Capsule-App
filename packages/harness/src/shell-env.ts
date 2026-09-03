import { spawnSync } from "node:child_process";

/*
 * The PATH the user actually has.
 *
 * An app launched from the Dock inherits a minimal environment — roughly
 * /usr/bin:/bin:/usr/sbin:/sbin — because macOS never runs a login shell for
 * it. Capsule used to paper over that with a list of directories written into
 * the source: Homebrew, /usr/local, a couple of vendor folders. That list is a
 * guess about someone else's machine, and it was wrong on the first one it was
 * checked against: `grok` lives in ~/.grok/bin and `kimi` in ~/.kimi-code/bin,
 * and neither was on it.
 *
 * It matters twice over. Capsule has to find a CLI to know a harness is
 * installed, and every process it starts — the terminal, git, an agent in
 * direct mode — inherits this PATH. A missing entry there surfaces inside the
 * agent's own turn, as a command it cannot find, looking like the agent's
 * fault.
 *
 * So ask the shell. Once, at startup, and never on a path that blocks a turn.
 */

/** Variables worth taking from the shell. PATH is the one that matters. */
const WANTED = ["PATH", "MANPATH", "NODE_PATH", "GOPATH", "CARGO_HOME", "BUN_INSTALL"];

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Read one `NAME=value` per line, ignoring anything else the shell printed.
 *
 * A login shell runs the user's rc files, and those print things: version
 * managers, greetings, warnings. Only lines shaped like an assignment for a
 * variable we asked for are taken.
 */
export function parseShellEnvironment(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    if (!WANTED.includes(name)) continue;
    const value = line.slice(at + 1).trim();
    if (value) out[name] = value;
  }
  return out;
}

/**
 * One PATH from several, in order, without repeats.
 *
 * The shell's own PATH comes first because it is the user's actual
 * configuration; the process PATH follows so nothing the launcher provided is
 * lost; the extras are a floor for the case where the shell could not be read
 * at all.
 */
export function mergePath(...paths: Array<string | undefined>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of paths) {
    for (const entry of (value ?? "").split(":")) {
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      parts.push(trimmed);
    }
  }
  return parts.join(":");
}

/**
 * Ask the login shell for its environment.
 *
 * `-ilc` is interactive and login: interactive because many people configure
 * PATH in .zshrc rather than .zprofile, login because others use .zprofile.
 * Returns nothing rather than guessing when the shell fails or is not there —
 * the caller keeps whatever it already had.
 */
export function readLoginShellEnvironment(
  options: { shell?: string; platform?: NodeJS.Platform } = {},
): Record<string, string> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return {};
  const shell = options.shell ?? process.env.SHELL ?? "/bin/zsh";
  try {
    const result = spawnSync(shell, ["-ilc", `printenv ${WANTED.join(" ")} 2>/dev/null || true`], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
    });
    // `printenv NAME...` prints values only, one per line, so ask for them in a
    // form that keeps the names attached.
    if (result.status === 0 && result.stdout.includes("=")) {
      return parseShellEnvironment(result.stdout);
    }
  } catch {
    // A shell that will not run is not an error worth failing startup over.
  }
  return namedEnvironment(shell, platform);
}

/** `printenv` without names prints NAME=value; that is the shape we want. */
function namedEnvironment(shell: string, platform: NodeJS.Platform): Record<string, string> {
  try {
    const result = spawnSync(shell, ["-ilc", "printenv"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
    });
    if (result.status === 0 && result.stdout) {
      const parsed = parseShellEnvironment(result.stdout);
      if (parsed.PATH) return parsed;
    }
  } catch {
    // Fall through to launchctl.
  }
  /*
   * launchctl holds the PATH the login session was given, which is what a
   * GUI app would have had if macOS had bothered. It is a weaker answer than
   * the shell's — it misses anything set in an rc file — but it beats the
   * hardcoded list.
   */
  if (platform !== "darwin") return {};
  try {
    const result = spawnSync("/bin/launchctl", ["getenv", "PATH"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const value = result.stdout?.trim();
    return result.status === 0 && value ? { PATH: value } : {};
  } catch {
    return {};
  }
}

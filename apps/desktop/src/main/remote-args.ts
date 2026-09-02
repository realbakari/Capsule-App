import type { RemoteAccess } from "@capsule/shared";

/**
 * The reach asked for on the command line, if any.
 *
 * `--remote` on its own means this Mac; `--remote=network` opens it to the
 * local network. `CAPSULE_REMOTE` does the same for a dev run, where the
 * launcher owns argv and a flag would never reach the app.
 */
export function remoteReachFromArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): RemoteAccess | undefined {
  const flag = argv.find((arg) => arg === "--remote" || arg.startsWith("--remote="));
  const value = flag?.includes("=")
    ? flag.slice(flag.indexOf("=") + 1)
    : flag
      ? "loopback"
      : env.CAPSULE_REMOTE;
  if (value === "network" || value === "loopback" || value === "off") return value;
  return undefined;
}

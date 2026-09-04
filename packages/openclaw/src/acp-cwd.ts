import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A stable, private directory: live Gateway sessions may outlive Capsule. */
function defaultAliasRoot(): string {
  const homeRoot = path.join(os.homedir(), ".capsule-acp-cwd");
  if (!/\s/.test(homeRoot)) return homeRoot;
  const tempRoot = path.join(os.tmpdir(), `capsule-acp-cwd-${process.getuid?.() ?? "user"}`);
  if (!/\s/.test(tempRoot)) return tempRoot;
  throw new Error("A whitespace-free folder is needed for Gateway working-directory aliases. Use Direct mode for a new local thread.");
}

/**
 * The Gateway slash parser does not unquote or decode values. A filesystem
 * alias preserves the exact folder without changing project/thread records or
 * routing the turn through a different runtime. Never send a local alias to a
 * non-loopback Gateway. Loopback tunnels still need a path on the remote host.
 */
export async function gatewayAcpCwd(
  cwd: string | undefined,
  gatewayHost: string,
  aliasRoot?: string,
): Promise<string | undefined> {
  if (!cwd) return cwd;
  if (cwd.includes("\0")) throw new Error("The working directory contains a null character.");
  if (!/\s/.test(cwd)) return cwd;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(gatewayHost.toLowerCase())) {
    throw new Error(
      "This remote Gateway cannot parse a working directory containing whitespace. " +
      "Use a whitespace-free path or folder alias on the Gateway host, or start a new local thread with a Direct-capable agent. " +
      "Your project does not need to be moved.",
    );
  }
  if (!path.isAbsolute(cwd)) throw new Error("Choose an absolute working directory for the local Gateway.");
  const target = await realpath(cwd);
  if (!(await stat(target)).isDirectory()) throw new Error("The working directory must be a folder.");
  // A user-provided symlink may already resolve to a parser-safe path.
  if (!/\s/.test(target)) return target;

  const root = aliasRoot ?? defaultAliasRoot();
  if (!path.isAbsolute(root) || /\s/.test(root)) {
    throw new Error("The Gateway folder-alias directory must be absolute and contain no whitespace.");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() ||
      (process.getuid && rootInfo.uid !== process.getuid()) ||
      (process.platform !== "win32" && (rootInfo.mode & 0o077) !== 0)) {
    throw new Error("The Gateway folder-alias directory must be a private directory owned by you.");
  }
  const alias = path.join(root, createHash("sha256").update(target).digest("hex"));
  try {
    await symlink(target, alias, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Do not overwrite an existing entry, including broken or redirected links.
  if (!(await lstat(alias)).isSymbolicLink() || await realpath(alias) !== target) {
    throw new Error("The Gateway folder alias points somewhere else. No existing files were changed.");
  }
  return alias;
}

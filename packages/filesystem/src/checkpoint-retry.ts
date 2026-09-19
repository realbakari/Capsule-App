import { git } from "./git-process.js";

/** Only idempotent snapshot plumbing may use this, never checkout or restore. */
export async function checkpointGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof git> {
  const safe = ["read-tree", "add", "write-tree", "update-ref"].includes(args[0] ?? "");
  for (let attempt = 0; ; attempt++) {
    const result = await git(cwd, args, env);
    const lockBusy = /\.lock['"]?: File exists/i.test(result.stderr);
    const disappeared = args[0] === "add" && /(?:unable to stat|could not open|open\().*(?:No such file or directory|does not exist)/i.test(result.stderr);
    if (!safe || result.ok || result.exitCode === undefined || attempt >= 2 || (!lockBusy && !disappeared)) return result;
    // Wait briefly for another writer, never remove its lock or alter the
    // user's index. Each checkpoint already owns a private staging index.
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
}

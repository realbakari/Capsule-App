import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Validate on the host, not in the renderer: paired clients may use another OS. */
export function worktreesDirectory(setting: string, userDataDir: string): string {
  if (!setting) return path.join(userDataDir, "worktrees");
  const expanded = /^~[\\/]/.test(setting) ? path.join(homedir(), setting.slice(2)) : setting;
  /* eslint-disable-next-line no-control-regex -- Paths cannot contain invisible controls. */
  if (!path.isAbsolute(expanded) || /[\u0000-\u001f\u007f]/u.test(expanded)) {
    throw new Error("Choose an absolute worktree folder on this computer.");
  }
  const directory = path.resolve(expanded);
  let existing = directory;
  while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  if (!statSync(existing).isDirectory()) throw new Error("The worktree location must be a folder.");
  const canonical = path.resolve(realpathSync(existing), path.relative(existing, directory));
  if (path.dirname(canonical) === canonical) throw new Error("Choose a worktree folder, not the root of a drive.");
  return canonical;
}

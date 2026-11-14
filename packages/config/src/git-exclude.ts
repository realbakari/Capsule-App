import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Keep a personal file out of the repository without touching the team's
 * `.gitignore`: add it to `info/exclude`, once. A worktree shares its main
 * repository's exclude file, which is where Git reads it from.
 */
export function excludeFromGit(file: string): void {
  const repository = findRepository(path.dirname(file));
  if (!repository) return;
  const pattern = path.relative(repository.top, file).split(path.sep).join("/");
  const exclude = path.join(repository.commonDir, "info", "exclude");
  let text = "";
  try {
    text = readFileSync(exclude, "utf8");
  } catch {
    // No exclude file yet.
  }
  if (text.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === `/${pattern}`)) return;
  mkdirSync(path.dirname(exclude), { recursive: true });
  appendFileSync(exclude, `${text && !text.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}

function findRepository(start: string): { top: string; commonDir: string } | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, ".git");
    try {
      const stats = statSync(dotGit);
      if (stats.isDirectory()) return { top: dir, commonDir: dotGit };
      const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
      if (!gitDir) return undefined;
      const resolved = path.resolve(dir, gitDir);
      let commonDir = resolved;
      try {
        commonDir = path.resolve(resolved, readFileSync(path.join(resolved, "commondir"), "utf8").trim());
      } catch {
        // Not a linked worktree.
      }
      return { top: dir, commonDir };
    } catch {
      // No .git here; keep walking up.
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

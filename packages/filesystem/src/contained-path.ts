import fs from "node:fs";
import path from "node:path";

export function assertPathContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is outside the project working directory");
  }
}

/** Resolve existing parents as well, so creation through a symlink is checked. */
function realPathWithMissingChildren(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling symlink is not permission to create its target elsewhere.
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(realPathWithMissingChildren(parent), path.basename(target));
  }
}

export function resolveProjectPath(projectRoot: string, target: string): string {
  const root = path.resolve(projectRoot);
  const requested = path.resolve(root, target);
  assertPathContained(root, requested);
  const resolved = realPathWithMissingChildren(requested);
  assertPathContained(realPathWithMissingChildren(root), resolved);
  return resolved;
}

/** Recheck after open: a parent could have changed while the open was pending. */
export function validateOpenedFile(file: string, opened: fs.Stats, projectRoot?: string): void {
  const currentPath = fs.realpathSync(file);
  if (projectRoot) assertPathContained(fs.realpathSync(projectRoot), currentPath);
  const current = fs.statSync(currentPath);
  if (current.dev !== opened.dev || current.ino !== opened.ino) {
    throw new Error("File changed while opening it. Try again.");
  }
}

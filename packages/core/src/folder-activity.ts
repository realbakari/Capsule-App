import { realpathSync } from "node:fs";
import path from "node:path";

export function folderKey(cwd: string): string {
  try { return realpathSync(cwd); } catch { /* Resolve the nearest existing parent below. */ }
  const absolute = path.resolve(cwd);
  let parent = absolute;
  for (;;) {
    try { return path.join(realpathSync(parent), path.relative(parent, absolute)); }
    catch {
      const next = path.dirname(parent);
      if (next === parent) return absolute;
      parent = next;
    }
  }
}

/** A command in a parent or nested project can write the restored subtree. */
export function foldersOverlap(left: string, right: string): boolean {
  const a = folderKey(left);
  const b = folderKey(right);
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  return inside(a, b) || inside(b, a);
}

/** Synchronous admission: no await can slip a writer between check and lock. */
export class FolderActivity {
  private readers = new Map<string, number>();
  private restoring = new Set<string>();

  assertAvailable(cwd: string | undefined): void {
    if (cwd && [...this.restoring].some((root) => foldersOverlap(root, cwd))) {
      throw new Error("This folder is being restored. Wait before starting work or saving files.");
    }
  }

  enter(cwd: string | undefined): () => void {
    if (!cwd) return () => undefined;
    const key = folderKey(cwd);
    this.assertAvailable(cwd);
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.readers.get(key) ?? 1) - 1;
      if (remaining) this.readers.set(key, remaining); else this.readers.delete(key);
    };
  }

  restore(cwd: string): () => void {
    const key = folderKey(cwd);
    this.assertAvailable(cwd);
    if ([...this.readers.keys()].some((root) => foldersOverlap(root, key))) {
      throw new Error("Work is still active in this folder. Stop agents, checks, actions and terminals before restoring it.");
    }
    this.restoring.add(key);
    return () => { this.restoring.delete(key); };
  }
}

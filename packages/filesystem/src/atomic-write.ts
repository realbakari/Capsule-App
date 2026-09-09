import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/*
 * A write that cannot leave half a file behind.
 *
 * Capsule writes several things a person would be upset to lose: the Gateway
 * token, the device identity it authenticates with, and — through the editor —
 * their own source files. All of them went out through `writeFileSync`, which
 * truncates the target first and then fills it. Lose power, run out of disk,
 * or crash between those two steps and the file is empty or half written, with
 * no copy of what it held.
 *
 * Writing beside it and renaming is atomic on the same filesystem: either the
 * old contents are there or the new ones are, never neither.
 */
export function writeFileAtomic(
  file: string,
  contents: string,
  options?: { mode?: number },
): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  let mode = options?.mode;
  if (mode === undefined) {
    try {
      const existing = fs.lstatSync(file);
      if (existing.isFile()) mode = existing.mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Beside the target, because rename across filesystems is not atomic and a
  // temp directory may be on another one.
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = fs.openSync(temp, "wx", mode ?? 0o666);
    created = true;
    fs.writeFileSync(descriptor, contents, "utf8");
    // An existing file's permissions are not subject to the current umask.
    // Explicit mode 000 is meaningful too; never test it by truthiness.
    if (mode !== undefined) fs.fchmodSync(descriptor, mode);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, file);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the original write failure. */ }
    }
    try {
      if (created) fs.rmSync(temp, { force: true });
    } catch {
      // The write already failed; a leftover temp file is the smaller problem.
    }
    throw error;
  }
}

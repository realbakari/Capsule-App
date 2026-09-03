import fs from "node:fs";
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
  // Beside the target, because rename across filesystems is not atomic and a
  // temp directory may be on another one.
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, contents, { encoding: "utf8", ...(options?.mode ? { mode: options.mode } : {}) });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The write already failed; a leftover temp file is the smaller problem.
    }
    throw error;
  }
}

/*
 * A cheap content fingerprint, used to detect that a file changed underneath an
 * open editor. Capsule's agent writes straight to disk over ACP, so the copy in
 * the editor can go stale at any moment; comparing revisions before a write
 * turns a silent clobber into a question.
 *
 * FNV-1a: not cryptographic, and it does not need to be. It only has to change
 * when the bytes change. The length prefix makes a collision need both the same
 * hash and the same length. Same construction as T3 Code's fileContentRevision.
 */
export function fileContentRevision(contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}

/** Thrown when a write would overwrite changes made since the file was read. */
export const FILE_CHANGED_ON_DISK = "FILE_CHANGED_ON_DISK";

export interface FileReadResult {
  contents: string;
  revision: string;
  /** True when `contents` is a prefix, so it must never be written back. */
  truncated: boolean;
}

import type { FileEntry } from "@capsule/shared";

/**
 * Whether two directory listings show the same entries in the same order.
 *
 * The inspector refetches the open directory whenever the workspace refreshes,
 * and a refresh happens on every message an agent streams. Replacing the state
 * with an equal-but-new array remounts the tree — losing what the reader had
 * expanded and flashing the rows — so an unchanged listing is dropped instead.
 */
export function sameListing(previous: readonly FileEntry[], next: readonly FileEntry[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((entry, index) => {
    const other = next[index];
    return other !== undefined && entry.path === other.path && entry.type === other.type;
  });
}

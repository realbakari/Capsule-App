import { parseUnifiedDiff, type DiffFile } from "@capsule/shared";

export const PREVIEW_PATCH_LINES = 84;
export const PREVIEW_LINE_CHARS = 600;
const PREVIEW_CHARS = 48_000;
const HEADER_CHARS = 8_192;

/** Read only the requested file's prefix, not every hunk in a large turn. */
export function savedDiffPreview(patch: string, path: string): { file: DiffFile; truncated: boolean } | undefined {
  let start = patch.startsWith("diff --git ") ? 0 : patch.indexOf("\ndiff --git ") + 1;
  if (start === 0 && !patch.startsWith("diff --git ")) return undefined;
  while (start < patch.length) {
    const next = patch.indexOf("\ndiff --git ", start + 1);
    const end = next < 0 ? patch.length : next + 1;
    const prefix = patch.slice(start, Math.min(end, start + HEADER_CHARS));
    const hunkStart = prefix.indexOf("\n@@");
    const metadata = parseUnifiedDiff(hunkStart < 0 ? prefix : prefix.slice(0, hunkStart))[0];
    // Exact names only: two directories may contain the same basename.
    if (metadata && (metadata.path === path || metadata.oldPath === path)) {
      const excerpt = patch.slice(start, Math.min(end, start + PREVIEW_CHARS));
      const lines = excerpt.split("\n");
      let truncated = excerpt.length < end - start;
      // Never render a half-read final line as if it were complete.
      if (truncated) lines.pop();
      if (lines.length > PREVIEW_PATCH_LINES) { lines.length = PREVIEW_PATCH_LINES; truncated = true; }
      const file = parseUnifiedDiff(lines.join("\n"))[0] ?? metadata;
      for (const hunk of file.hunks) {
        if (hunk.header.length > PREVIEW_LINE_CHARS) { hunk.header = hunk.header.slice(0, PREVIEW_LINE_CHARS) + "…"; truncated = true; }
        for (const line of hunk.lines) {
          if (line.text.length > PREVIEW_LINE_CHARS) { line.text = line.text.slice(0, PREVIEW_LINE_CHARS) + "…"; truncated = true; }
        }
      }
      return { file, truncated };
    }
    if (next < 0) break;
    start = next + 1;
  }
  return undefined;
}

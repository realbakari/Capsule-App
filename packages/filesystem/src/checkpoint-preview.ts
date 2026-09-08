import type { TurnDiffOptions, TurnDiffResult } from "@capsule/shared";
import { hasCheckpoint } from "./checkpoints.js";
import { CANONICAL_PATCH_FLAGS, parseNumstat } from "./git-output.js";
import { gitExcerpt, inRepository } from "./git-process.js";

export const CHECKPOINT_PATCH_BYTES = 512 * 1024;
export const CHECKPOINT_SUMMARY_BYTES = 1024 * 1024;
export const CHECKPOINT_FILE_LIMIT = 2000;

/** A partial record is not a filename or a line of code. */
function completeRecords(text: string, delimiter: string, truncated: boolean): string {
  return truncated ? text.slice(0, text.lastIndexOf(delimiter) + 1) : text;
}

/** Summaries never depend on reading a potentially enormous patch. */
export async function previewCheckpoint(cwd: string, to: string, from: string, options: TurnDiffOptions = {}): Promise<TurnDiffResult> {
  return inRepository(cwd, async () => {
    if (!(await hasCheckpoint(cwd, from)) || !(await hasCheckpoint(cwd, to))) {
      throw new Error("A recorded checkpoint could not be read. Check that the repository and its saved refs are available.");
    }
    const relative = options.relative;
    if (relative !== undefined && (!relative || relative.includes("\0") || relative.startsWith("/") || relative.split("/").includes(".."))) {
      throw new Error("Choose a file inside this saved turn.");
    }
    // No external diff drivers, text conversion or rename similarity scans.
    // A literal pathspec keeps punctuation in a filename from becoming a glob.
    // The parser needs canonical prefixes even for binary/metadata-only patches
    // without ---/+++ headers. Never inherit diff.noprefix or mnemonicPrefix.
    const base = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", ...CANONICAL_PATCH_FLAGS];
    const range = [from, to, "--", ...(relative ? [relative] : [])];
    const files: TurnDiffResult["files"] = [];
    let filesTruncated = false;
    if (!relative) {
      const names = await gitExcerpt(cwd, [...base, "--name-status", "-z", ...range], CHECKPOINT_SUMMARY_BYTES);
      const fields = completeRecords(names.stdout, "\0", names.truncated).split("\0");
      for (let index = 0; index + 1 < fields.length && fields[index + 1]; index += 2) {
        if (files.length === CHECKPOINT_FILE_LIMIT) { filesTruncated = true; break; }
        files.push({ path: fields[index + 1]!, status: fields[index] === "A" ? "added" : fields[index] === "D" ? "deleted" : "modified" });
      }
      filesTruncated ||= names.truncated;
      const stats = await gitExcerpt(cwd, [...base, "--numstat", "-z", ...range], CHECKPOINT_SUMMARY_BYTES);
      const counts = new Map(parseNumstat(completeRecords(stats.stdout, "\0", stats.truncated)).map((entry) => [entry.path, entry]));
      for (const file of files) Object.assign(file, counts.get(file.path));
      // Unknown counts stay absent, including binary files and budgeted stats.
      filesTruncated ||= stats.truncated;
    }
    if (options.summaryOnly) return { available: true, patch: "", files, filesTruncated };
    const patch = await gitExcerpt(cwd, [...base, ...range], CHECKPOINT_PATCH_BYTES);
    return { available: true, files, filesTruncated, patch: completeRecords(patch.stdout, "\n", patch.truncated), patchTruncated: patch.truncated };
  }, JSON.stringify(["checkpointPreview", cwd, to, from, options]));
}

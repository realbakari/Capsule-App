/**
 * Per-hunk Keep, Reject and Unstage for Review.
 *
 * Review shows one of several diffs (a scope). Acting on a hunk means handing
 * git a patch that holds just that hunk and saying where to apply it: the
 * index, the working tree, or both, forwards or in reverse. Everything here is
 * pure: it reads parsed diffs and returns patches. Running `git apply` is the
 * filesystem package's job.
 */
import type { DiffFile, DiffHunk } from "./diff.js";

export type DiffScope = "uncommitted" | "staged" | "unstaged" | "turn" | "branch";

export const DIFF_SCOPES: ReadonlyArray<{ id: DiffScope; label: string; detail: string }> = [
  { id: "uncommitted", label: "Uncommitted", detail: "Staged and unstaged changes against the last commit" },
  { id: "staged", label: "Staged", detail: "Changes in the index, ready to commit" },
  { id: "unstaged", label: "Unstaged", detail: "Working-tree changes not yet staged" },
  { id: "turn", label: "This turn", detail: "What the latest turn changed" },
  { id: "branch", label: "Branch", detail: "Everything since this branch left the default branch" },
];

/** The scopes git answers directly. "This turn" comes from saved checkpoints. */
export type GitDiffScope = Exclude<DiffScope, "turn">;

export interface ScopedDiff {
  patch: string;
  /** For Branch, the branch the diff is measured from. */
  base?: string;
}

export function isDiffScope(value: unknown): value is DiffScope {
  return DIFF_SCOPES.some((scope) => scope.id === value);
}

export type HunkAction = "keep" | "reject" | "unstage";

/** One `git apply` of `patch`, forwards or reversed. */
export interface PatchApplication {
  patch: string;
  reverse: boolean;
}

/**
 * What one action does. Each target is applied at most once, and the
 * filesystem checks every part before it applies any, so an action either
 * lands whole or changes nothing.
 */
export interface HunkApply {
  index?: PatchApplication;
  worktree?: PatchApplication;
}

/**
 * The diffs Review holds for one file. `shown` is the scope's own diff. The
 * Uncommitted scope also carries the file's staged (HEAD to index) and
 * unstaged (index to working tree) diffs, because a combined hunk can be
 * either, or partly both.
 */
export interface ReviewFileDiffs {
  shown: DiffFile;
  staged?: DiffFile;
  unstaged?: DiffFile;
}

export type HunkStage = "unstaged" | "staged" | "partly";

const GIT_ESCAPES: Record<string, string> = { "\x07": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\v": "\\v", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };

/** A path as git writes it in a patch header: C-quoted only when it must be. */
export function quoteGitPath(prefixed: string): string {
  let quoted = "";
  let needed = false;
  for (const char of prefixed) {
    const code = char.codePointAt(0)!;
    const escaped = GIT_ESCAPES[char] ?? (code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, "0")}` : undefined);
    needed ||= escaped !== undefined;
    quoted += escaped ?? char;
  }
  return needed ? `"${quoted}"` : prefixed;
}

/**
 * A patch holding only the chosen hunks of one file.
 *
 * The patch never moves a file or changes its mode: a hunk of a renamed file
 * edits the file where it now is. A created or deleted file has a single
 * hunk that covers the whole file, so its patch still creates or deletes it.
 * Hunk headers keep their original line numbers; git places each hunk by its
 * context, and the side it reads (old for forwards, new for reverse) is exact
 * for a single hunk.
 */
export function hunkPatch(file: DiffFile, hunks: readonly number[]): string {
  const a = quoteGitPath(`a/${file.path}`);
  const b = quoteGitPath(`b/${file.path}`);
  const head = [`diff --git ${a} ${b}`];
  if (file.status === "added") head.push(`new file mode ${file.mode ?? "100644"}`, "--- /dev/null", `+++ ${b}`);
  else if (file.status === "deleted") head.push(`deleted file mode ${file.mode ?? "100644"}`, `--- ${a}`, "+++ /dev/null");
  else head.push(`--- ${a}`, `+++ ${b}`);
  const body = [...new Set(hunks)].sort((x, y) => x - y).flatMap((index) => {
    const hunk = file.hunks[index];
    if (!hunk) throw new RangeError(`No hunk ${index} in ${file.path}.`);
    return [hunk.header, ...hunk.lines.flatMap((line) => {
      const text = `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`;
      return line.noNewline ? [text, "\\ No newline at end of file"] : [text];
    })];
  });
  return `${[...head, ...body].join("\n")}\n`;
}

type Side = "old" | "new";

/** The lines a hunk covers on one side, as an inclusive range. */
function hunkRange(hunk: DiffHunk, side: Side): [number, number] {
  const start = side === "old" ? hunk.oldStart : hunk.newStart;
  const count = hunk.lines.filter((line) => line.kind === "context" || line.kind === (side === "old" ? "del" : "add")).length;
  return [start, start + count];
}

/**
 * Where a hunk's changes sit on one side. A line that exists only on the
 * other side sits at the position the walk has reached there.
 */
function changeRange(hunk: DiffHunk, side: Side): [number, number] | undefined {
  const own = side === "old" ? "del" : "add";
  let cursor = side === "old" ? hunk.oldStart : hunk.newStart;
  let first: number | undefined;
  let last = cursor;
  for (const line of hunk.lines) {
    if (line.kind === "context") { cursor += 1; continue; }
    first ??= cursor;
    last = cursor;
    if (line.kind === own) cursor += 1;
  }
  return first === undefined ? undefined : [first, last];
}

function overlapping(shown: DiffFile, picked: readonly number[], other: DiffFile | undefined, side: Side): number[] {
  if (!other) return [];
  const ranges = picked.flatMap((index) => shown.hunks[index] ? [hunkRange(shown.hunks[index], side)] : []);
  return other.hunks.flatMap((hunk, index) => {
    const span = changeRange(hunk, side);
    return span && ranges.some(([from, to]) => span[0] <= to && span[1] >= from) ? [index] : [];
  });
}

/*
 * A combined hunk runs from the last commit to the working tree. Its staged
 * part shares the commit's line numbers (the old side); its unstaged part
 * shares the working tree's (the new side).
 */
function stagedParts(diffs: ReviewFileDiffs, picked: readonly number[]): number[] {
  return overlapping(diffs.shown, picked, diffs.staged, "old");
}

function unstagedParts(diffs: ReviewFileDiffs, picked: readonly number[]): number[] {
  return overlapping(diffs.shown, picked, diffs.unstaged, "new");
}

/** Whether an Uncommitted hunk is staged, unstaged, or a mix of both. */
export function hunkStage(diffs: ReviewFileDiffs, hunk: number): HunkStage {
  const staged = stagedParts(diffs, [hunk]).length > 0;
  const unstaged = unstagedParts(diffs, [hunk]).length > 0;
  return staged && unstaged ? "partly" : staged ? "staged" : "unstaged";
}

/** Reverting hunks of a diff whose new side is the working tree. */
export function rejectHunks(file: DiffFile, hunks: readonly number[]): HunkApply {
  return { worktree: { patch: hunkPatch(file, hunks), reverse: true } };
}

type Actions = Partial<Record<HunkAction, HunkApply>>;

const SCOPE_ACTIONS: Record<DiffScope, (diffs: ReviewFileDiffs, hunks: readonly number[]) => Actions> = {
  uncommitted: (diffs, hunks) => {
    const staged = stagedParts(diffs, hunks);
    const unstaged = unstagedParts(diffs, hunks);
    const unstage = diffs.staged && staged.length ? { patch: hunkPatch(diffs.staged, staged), reverse: true } : undefined;
    return {
      ...(diffs.unstaged && unstaged.length ? { keep: { index: { patch: hunkPatch(diffs.unstaged, unstaged), reverse: false } } } : {}),
      ...(unstage ? { unstage: { index: unstage } } : {}),
      reject: { ...rejectHunks(diffs.shown, hunks), ...(unstage ? { index: unstage } : {}) },
    };
  },
  unstaged: (diffs, hunks) => ({
    keep: { index: { patch: hunkPatch(diffs.shown, hunks), reverse: false } },
    reject: rejectHunks(diffs.shown, hunks),
  }),
  staged: (diffs, hunks) => ({ unstage: { index: { patch: hunkPatch(diffs.shown, hunks), reverse: true } } }),
  turn: () => ({}),
  branch: () => ({}),
};

/**
 * The actions a scope offers for some hunks of a file, each already turned
 * into the patches it applies. An action that would do nothing is absent.
 */
export function hunkActions(scope: DiffScope, diffs: ReviewFileDiffs, hunks: readonly number[]): Actions {
  if (diffs.shown.binary || hunks.length === 0) return {};
  return SCOPE_ACTIONS[scope](diffs, hunks);
}

/** Every hunk of a file, for Keep all and Reject all. */
export function allHunks(file: DiffFile): number[] {
  return file.hunks.map((_, index) => index);
}

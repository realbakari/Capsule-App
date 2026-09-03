/**
 * A unified diff, read into files, hunks and lines.
 *
 * The pull request view used to hand the whole patch to one `<pre>` and colour
 * each line by its first character. That renders, but it is not a diff: there
 * is no way to collapse a file, no line numbers to refer to, no way to put the
 * two sides next to each other, and nothing to hang a comment on. A patch for
 * eleven files also arrives as one continuous scroll of several thousand
 * elements, all of them mounted at once.
 *
 * Parsing is pure and has no opinion about presentation, so the same reading
 * serves the unified view, the split view, and anything that needs to know
 * which line of which file a position refers to.
 */

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line's text, without the leading +, - or space. */
  text: string;
  /** Line number on the left — absent for an added line. */
  oldLine?: number;
  /** Line number on the right — absent for a removed line. */
  newLine?: number;
}

export interface DiffHunk {
  /** The `@@ … @@` line, including any trailing section heading. */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type DiffFileStatus = "added" | "deleted" | "renamed" | "modified";

export interface DiffFile {
  /** Where the file is after the change; for a delete, where it was. */
  path: string;
  /** Where it was before, only when that differs. */
  oldPath?: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  /** True when git declined to show the contents. */
  binary: boolean;
  hunks: DiffHunk[];
}

/** `a/src/x.ts` and `b/src/x.ts` — git's prefixes, which are not path. */
function stripPrefix(value: string): string {
  if (value === "/dev/null") return "";
  return value.replace(/^[ab]\//, "");
}

/**
 * `@@ -12,7 +12,9 @@ optional heading`
 *
 * A count of 1 may be written without the comma, so both forms are read.
 */
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | undefined {
  const match = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return undefined;
  return { oldStart: Number(match[1]), newStart: Number(match[3]) };
}

/**
 * Read a patch as produced by `git diff` or `gh pr diff`.
 *
 * Anything unrecognised is skipped rather than guessed at: a malformed patch
 * should show the files it could read, not throw away the whole reading.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  if (!text.trim()) return [];
  /*
   * A patch ends with a newline, and splitting on it leaves a trailing empty
   * string. Read as a line that is neither added nor removed, it became a
   * blank context line appended to the last hunk of every patch.
   */
  const lines = text.replace(/\n$/, "").split("\n");
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const closeFile = () => {
    if (file) files.push(file);
    file = undefined;
    hunk = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.startsWith("diff --git ")) {
      closeFile();
      // `diff --git a/x b/x`, which is the only reliable name for a file whose
      // hunks never arrive — a pure rename, or a binary.
      const match = /^diff --git (\S+) (\S+)$/.exec(line);
      const from = stripPrefix(match?.[1] ?? "");
      const to = stripPrefix(match?.[2] ?? "");
      file = {
        path: to || from,
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
        hunks: [],
      };
      continue;
    }

    if (!file) continue;

    if (line.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      file.oldPath = line.slice("rename from ".length).trim();
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.path = line.slice("rename to ".length).trim();
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.binary = true;
      continue;
    }

    if (line.startsWith("--- ")) {
      const from = stripPrefix(line.slice(4).trim());
      if (from) file.oldPath = file.oldPath ?? from;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const to = stripPrefix(line.slice(4).trim());
      if (to) file.path = to;
      continue;
    }

    const header = parseHunkHeader(line);
    if (header) {
      hunk = { header: line, oldStart: header.oldStart, newStart: header.newStart, lines: [] };
      file.hunks.push(hunk);
      oldLine = header.oldStart;
      newLine = header.newStart;
      continue;
    }

    if (!hunk) continue;

    /*
     * "\ No newline at end of file" annotates the line before it and is not
     * itself a line of either side.
     */
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const body = line.slice(1);
    if (marker === "+") {
      hunk.lines.push({ kind: "add", text: body, newLine });
      newLine += 1;
      file.additions += 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text: body, oldLine });
      oldLine += 1;
      file.deletions += 1;
    } else if (marker === " " || line === "") {
      // An empty context line arrives as a genuinely empty string rather than
      // a single space, depending on who wrote the patch.
      hunk.lines.push({ kind: "context", text: body, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  closeFile();
  return files;
}

export interface DiffRow {
  left?: DiffLine;
  right?: DiffLine;
}

/**
 * A hunk's lines paired for a side-by-side view.
 *
 * A run of removals followed by a run of additions is one edit shown twice, so
 * they are zipped into rows: the first removal beside the first addition, and
 * so on, with a blank cell wherever one side runs out. Context lines occupy
 * both cells, which is what keeps the two columns aligned.
 */
export function splitRows(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (!line) break;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const removals: DiffLine[] = [];
    const additions: DiffLine[] = [];
    for (let next = hunk.lines[index]; next?.kind === "del"; next = hunk.lines[++index]) {
      removals.push(next);
    }
    for (let next = hunk.lines[index]; next?.kind === "add"; next = hunk.lines[++index]) {
      additions.push(next);
    }
    const height = Math.max(removals.length, additions.length);
    for (let row = 0; row < height; row += 1) {
      rows.push({ left: removals[row], right: additions[row] });
    }
  }
  return rows;
}

/** How many lines a file's hunks hold, for deciding what to open by default. */
export function diffFileSize(file: DiffFile): number {
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

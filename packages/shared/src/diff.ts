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
  value = decodeGitPath(value);
  if (value === "/dev/null") return "";
  return value.replace(/^[ab]\//, "");
}

/** Git's C-quoted paths encode UTF-8 bytes using octal escapes, not JSON. */
export function decodeGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const source = value.slice(1, -1);
  for (let i = 0; i < source.length;) {
    if (source[i] === "\\") {
      const octal = /^[0-7]{1,3}/.exec(source.slice(i + 1));
      if (octal) { bytes.push(Number.parseInt(octal[0], 8)); i += octal[0].length + 1; continue; }
      const escaped = source[i + 1];
      if (escaped && escapes[escaped] !== undefined) { bytes.push(escapes[escaped]!); i += 2; continue; }
    }
    const point = String.fromCodePoint(source.codePointAt(i)!);
    bytes.push(...new TextEncoder().encode(point));
    i += point.length;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function patchPaths(line: string): [string, string] {
  const quoted = /^("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/.exec(line.slice(11));
  return [stripPrefix(quoted?.[1] ?? ""), stripPrefix(quoted?.[2] ?? "")];
}

/**
 * `@@ -12,7 +12,9 @@ optional heading`
 *
 * A count of 1 may be written without the comma, so both forms are read.
 */
function parseHunkHeader(line: string): { oldStart: number; newStart: number; oldCount: number; newCount: number } | undefined {
  const match = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return undefined;
  return { oldStart: Number(match[1]), newStart: Number(match[3]), oldCount: Number(match[2] ?? 1), newCount: Number(match[4] ?? 1) };
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
  let oldRemaining = 0;
  let newRemaining = 0;

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
      const [from, to] = patchPaths(line);
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

    if (hunk && oldRemaining === 0 && newRemaining === 0) hunk = undefined;
    if (hunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
      const marker = line[0];
      const body = line.slice(1);
      if (marker === "+" && newRemaining > 0) {
        hunk.lines.push({ kind: "add", text: body, newLine: newLine++ });
        newRemaining--; file.additions++;
      } else if (marker === "-" && oldRemaining > 0) {
        hunk.lines.push({ kind: "del", text: body, oldLine: oldLine++ });
        oldRemaining--; file.deletions++;
      } else if ((marker === " " || line === "") && oldRemaining > 0 && newRemaining > 0) {
        hunk.lines.push({ kind: "context", text: body, oldLine: oldLine++, newLine: newLine++ });
        oldRemaining--; newRemaining--;
      }
      continue;
    }

    if (line.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      file.oldPath = decodeGitPath(line.slice("rename from ".length));
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.path = decodeGitPath(line.slice("rename to ".length));
      file.status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.binary = true;
      continue;
    }

    if (line.startsWith("--- ")) {
      const from = stripPrefix(line.slice(4).replace(/\t$/, ""));
      if (from) file.oldPath = file.oldPath ?? from;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const to = stripPrefix(line.slice(4).replace(/\t$/, ""));
      if (to) file.path = to;
      continue;
    }

    const header = parseHunkHeader(line);
    if (header) {
      hunk = { header: line, oldStart: header.oldStart, newStart: header.newStart, lines: [] };
      file.hunks.push(hunk);
      oldLine = header.oldStart;
      newLine = header.newStart;
      oldRemaining = header.oldCount;
      newRemaining = header.newCount;
      continue;
    }

    if (!hunk) continue;

    /*
     * "\ No newline at end of file" annotates the line before it and is not
     * itself a line of either side.
     */
    if (line.startsWith("\\")) continue;

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

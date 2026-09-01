/**
 * GitHub-style pipe tables.
 *
 * Agents reach for a table whenever they summarise a folder, a set of findings
 * or a comparison, and without a parser those arrive as a wall of pipes and
 * dashes — the one shape markdown makes worse rather than better when it is
 * not rendered.
 *
 * Deliberately strict about what counts as a table: a delimiter row of dashes
 * directly under a header row. Prose that merely contains a pipe stays prose.
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
  /** Per-column alignment from the delimiter row (:--, --:, :-:). */
  align: Array<"left" | "right" | "center">;
}

/** Split a row on unescaped pipes, dropping the optional leading/trailing one. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function alignmentOf(cell: string): "left" | "right" | "center" | undefined {
  const value = cell.trim();
  if (!/^:?-{1,}:?$/.test(value)) return undefined;
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

/**
 * Read a table starting at `index`, or undefined when there is not one.
 * Returns how many lines it consumed so the caller can continue past it.
 */
export function parseTable(
  lines: string[],
  index: number,
): { table: MarkdownTable; consumed: number } | undefined {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header || !delimiter) return undefined;
  if (!header.includes("|") || !delimiter.includes("|")) return undefined;

  const headers = cells(header);
  const align = cells(delimiter).map(alignmentOf);
  // Every delimiter cell must be dashes, and there must be as many as there
  // are headers — otherwise this is prose that happens to contain pipes.
  if (align.length !== headers.length || align.some((value) => value === undefined)) {
    return undefined;
  }

  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === undefined || !line.includes("|") || line.trim() === "") break;
    const row = cells(line);
    // Pad or trim so every row matches the header, rather than dropping data
    // or leaving a ragged table.
    while (row.length < headers.length) row.push("");
    rows.push(row.slice(0, headers.length));
    cursor += 1;
  }

  return {
    table: { headers, rows, align: align as Array<"left" | "right" | "center"> },
    consumed: cursor - index,
  };
}

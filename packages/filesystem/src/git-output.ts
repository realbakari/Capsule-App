import type { GitChange } from "@capsule/shared";

/** Machine-read patches must not inherit terminal colors or custom prefixes. */
export const CANONICAL_PATCH_FLAGS = ["--no-color", "--src-prefix=a/", "--dst-prefix=b/"];

/** Porcelain v1 -z: renamed destination first, then original name. */
export function parsePorcelain(text: string): GitChange[] {
  const fields = text.split("\0");
  const result: GitChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i]!;
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    result.push({ path: record.slice(3), code: status.trim() || "?" });
    if (/[RC]/.test(status)) i++;
  }
  return result;
}

export function parseNumstat(text: string): Array<{ path: string; added?: number; removed?: number }> {
  const fields = text.split("\0");
  const result: Array<{ path: string; added?: number; removed?: number }> = [];
  for (let i = 0; i < fields.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]!);
    if (!match) continue;
    let name = match[3]!;
    if (!name) { i++; name = fields[++i] ?? ""; } // rename: old NUL new
    if (!name) continue;
    result.push({ path: name, ...(match[1] === "-" ? {} : { added: Number(match[1]), removed: Number(match[2]) }) });
  }
  return result;
}

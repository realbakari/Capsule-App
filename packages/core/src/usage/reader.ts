import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { summarise, type UsageSummary } from "./aggregate.js";
import {
  newCodexScanState,
  parseClaudeLine,
  parseCodexLine,
  type UsageRecord,
} from "./transcripts.js";

/**
 * Walks the CLIs' transcript directories and turns them into usage records.
 *
 * Reading is deliberately cheap to skip: a transcript whose mtime predates the
 * window cannot contain records inside it, so it is never opened. On a machine
 * with a long history that is most of the files.
 */

export interface UsageRoots {
  claude: string;
  codex: string;
}

export function defaultUsageRoots(home = os.homedir()): UsageRoots {
  return {
    claude: path.join(home, ".claude", "projects"),
    codex: path.join(home, ".codex", "sessions"),
  };
}

/** `.jsonl` files under `root`, skipping those untouched since `sinceMs`. */
function transcriptFiles(root: string, sinceMs?: number, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // A provider that was never installed has no directory. Not an error.
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      transcriptFiles(full, sinceMs, out);
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) continue;
    if (sinceMs !== undefined) {
      try {
        // mtime is when the session last wrote, so a file older than the
        // window holds nothing inside it.
        if (fs.statSync(full).mtimeMs < sinceMs) continue;
      } catch {
        continue;
      }
    }
    out.push(full);
  }
  return out;
}

function readRecords(file: string, parse: (line: string) => UsageRecord | undefined): UsageRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records: UsageRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const record = parse(line);
    if (record) records.push(record);
  }
  return records;
}

export function collectUsageRecords(roots: UsageRoots, sinceMs?: number): UsageRecord[] {
  const records: UsageRecord[] = [];
  for (const file of transcriptFiles(roots.claude, sinceMs)) {
    records.push(...readRecords(file, parseClaudeLine));
  }
  for (const file of transcriptFiles(roots.codex, sinceMs)) {
    // Codex names the file after the session; the lines do not always repeat
    // it. The scan state is per file and carries the model forward from the
    // turn_context lines that declare it.
    const sessionId = path.basename(file, ".jsonl");
    const state = newCodexScanState();
    records.push(...readRecords(file, (line) => parseCodexLine(line, sessionId, state)));
  }
  return records;
}

export function readUsageSummary(sinceMs?: number, roots = defaultUsageRoots()): UsageSummary {
  return summarise(collectUsageRecords(roots, sinceMs), sinceMs);
}

/*
 * The same walk, without stopping the world.
 *
 * The synchronous version above reads every transcript in the window in one
 * unbroken run of readFileSync and JSON.parse. On a machine with real history
 * that is not a pause, it is a freeze: measured here, a 30-day window took
 * 2.4s and a 90-day window 10.0s, and every one of those seconds was Electron's
 * main process refusing to redraw a window or answer any other IPC call. This
 * awaits per file, so the event loop runs between them, and remembers what it
 * parsed so a second look costs only the files that changed since the first.
 */

interface CachedFile {
  mtimeMs: number;
  /** Bytes parsed so far, ending on a line boundary. */
  parsed: number;
  records: UsageRecord[];
}

/*
 * Keyed by path, and appended to rather than rebuilt.
 *
 * These transcripts get big: on this machine seven Codex rollouts run from
 * 288MB to 902MB and the sessions directory holds 5.6GB. A session still in
 * use is appended to constantly, so any cache keyed on "has this file changed"
 * misses it every single scan and re-reads the whole thing. They are
 * append-only, though, which means the bytes already parsed cannot change —
 * so a later scan reads only what was added since.
 */
const fileCache = new Map<string, CachedFile>();

/** Forgets the parsed transcripts, for a test or a Doctor run. */
export function clearUsageCache(): void {
  fileCache.clear();
}

async function transcriptFilesAsync(
  root: string,
  sinceMs: number | undefined,
  out: string[] = [],
): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await transcriptFilesAsync(full, sinceMs, out);
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) continue;
    if (sinceMs !== undefined) {
      try {
        if ((await fsp.stat(full)).mtimeMs < sinceMs) continue;
      } catch {
        continue;
      }
    }
    out.push(full);
  }
  return out;
}

/**
 * Parse `file` from byte `from`, a line at a time.
 *
 * Streamed rather than read whole. `readFile` on a 902MB transcript holds the
 * entire thing in memory as one string and then splits it into an array of
 * millions more — a multi-gigabyte spike on Electron's main process for one
 * file, and past V8's limit on string length it does not return a string at
 * all, it throws, and the file is silently counted as empty. A stream costs
 * one line at a time however large the file is.
 *
 * Returns the records and the offset of the last complete line, so the next
 * scan resumes exactly where this one stopped rather than mid-line.
 */
async function parseFrom(
  file: string,
  from: number,
  parse: (line: string) => UsageRecord | undefined,
): Promise<{ records: UsageRecord[]; parsed: number }> {
  const records: UsageRecord[] = [];
  let parsed = from;
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, "r");
    const stream = handle.createReadStream({ start: from, encoding: "utf8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      // The newline the reader consumed counts too, or the offset drifts back
      // by one byte per line and every later scan re-reads from mid-file.
      parsed += Buffer.byteLength(line, "utf8") + 1;
      if (!line) continue;
      const record = parse(line);
      if (record) records.push(record);
    }
  } catch {
    // An unreadable transcript contributes nothing; it is not an error worth
    // failing the whole reading over.
    return { records, parsed };
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return { records, parsed };
}

async function recordsFor(
  file: string,
  parse: (line: string) => UsageRecord | undefined,
): Promise<UsageRecord[]> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return [];
  }
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.parsed >= stat.size) {
    return cached.records;
  }
  /*
   * Resume where the last scan stopped, unless the file is now smaller than
   * what was read from it — rotated or rewritten, so the old records are no
   * longer this file's and the whole thing is read again.
   */
  const from = cached && stat.size >= cached.parsed ? cached.parsed : 0;
  const previous = from > 0 && cached ? cached.records : [];
  const { records: added, parsed } = await parseFrom(file, from, parse);
  const records = previous.length === 0 ? added : previous.concat(added);
  fileCache.set(file, { mtimeMs: stat.mtimeMs, parsed, records });
  return records;
}

export async function collectUsageRecordsAsync(
  roots: UsageRoots,
  sinceMs?: number,
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  /*
   * Appended one at a time, not spread. `push(...batch)` passes every element
   * as an argument, and a transcript can hold twenty thousand records: with
   * everything already cached and no parsing left to do, gathering them that
   * way still cost 2.9s of the 3.1s a second look took.
   */
  const append = (batch: UsageRecord[]) => {
    for (const record of batch) records.push(record);
  };
  for (const file of await transcriptFilesAsync(roots.claude, sinceMs)) {
    append(await recordsFor(file, parseClaudeLine));
  }
  for (const file of await transcriptFilesAsync(roots.codex, sinceMs)) {
    const sessionId = path.basename(file, ".jsonl");
    const state = newCodexScanState();
    append(await recordsFor(file, (line) => parseCodexLine(line, sessionId, state)));
  }
  return records;
}

export async function readUsageSummaryAsync(
  sinceMs?: number,
  roots = defaultUsageRoots(),
): Promise<UsageSummary> {
  return summarise(await collectUsageRecordsAsync(roots, sinceMs), sinceMs);
}

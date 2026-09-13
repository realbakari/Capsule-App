import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { summarise, type UsageSummary } from "./aggregate.js";
import {
  newCodexScanState,
  parseClaudeLine,
  parseCodexLine,
  type UsageRecord,
  type UsageProvider,
  type CodexScanState,
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

export function defaultUsageRoots(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): UsageRoots {
  function providerHome(variable: string, fallback: string): string {
    const configured = env[variable];
    if (!configured?.trim()) return path.join(home, fallback);
    if (configured === "~") return home;
    if (configured.startsWith("~/")) return path.join(home, configured.slice(2));
    // A relative home belongs to a CLI's cwd, not Capsule's process cwd.
    // This global report cannot pick one project's transcripts arbitrarily.
    if (!path.isAbsolute(configured)) throw new Error(`Set ${variable} to an absolute path to read usage from that CLI home.`);
    return configured;
  }
  return {
    claude: path.join(providerHome("CLAUDE_CONFIG_DIR", ".claude"), "projects"),
    codex: path.join(providerHome("CODEX_HOME", ".codex"), "sessions"),
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
  size: number;
  dev: number;
  ino: number;
  /** Bytes parsed so far, ending on a line boundary. */
  parsed: number;
  records: UsageRecord[];
  tailRecords: UsageRecord[];
  state: CodexScanState;
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
const MAX_CACHED_FILES = 256;
const MAX_CACHED_RECORDS = 200_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;

function cacheFile(file: string, value: CachedFile): void {
  fileCache.delete(file);
  if (value.records.length > MAX_CACHED_RECORDS) return;
  fileCache.set(file, value);
  let count = [...fileCache.values()].reduce((sum, item) => sum + item.records.length, 0);
  for (const [key, item] of fileCache) {
    if (fileCache.size <= MAX_CACHED_FILES && count <= MAX_CACHED_RECORDS) break;
    fileCache.delete(key);
    count -= item.records.length;
  }
}

/** Forgets the parsed transcripts, for a test or a Doctor run. */
export function clearUsageCache(): void {
  fileCache.clear();
}

async function transcriptFilesAsync(
  root: string,
  sinceMs: number | undefined,
  unavailable: () => void,
  out: string[] = [],
): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (error) {
    // An uninstalled CLI has no directory; permission and I/O failures are
    // unavailable coverage, not evidence that the user did no work.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") unavailable();
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await transcriptFilesAsync(full, sinceMs, unavailable, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    if (sinceMs !== undefined) {
      try {
        if ((await fsp.stat(full)).mtimeMs < sinceMs) continue;
      } catch {
        unavailable();
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
  expected: fs.Stats,
): Promise<{ records: UsageRecord[]; parsed: number; tail: string; failed?: boolean }> {
  const records: UsageRecord[] = [];
  let parsed = from;
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("Transcript is not a regular file.");
    if (opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size < from) throw new Error("Transcript changed before it could be read. Retry the scan.");
    const stream = handle.createReadStream({ start: from });
    let pending = Buffer.alloc(0);
    for await (const chunk of stream) {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk as Buffer;
      let start = 0;
      let end: number;
      while ((end = bytes.indexOf(10, start)) !== -1) {
        if (end - start > MAX_LINE_BYTES) throw new Error("Transcript line exceeds the read budget.");
        const record = parse(bytes.subarray(start, end).toString("utf8"));
        if (record) records.push(record);
        parsed += end - start + 1; // Exact byte offsets, including CRLF and UTF-8.
        start = end + 1;
      }
      pending = Buffer.from(bytes.subarray(start));
      if (pending.length > MAX_LINE_BYTES) throw new Error("Transcript line exceeds the read budget.");
    }
    // EOF is not a line boundary: the writer may still be writing this JSON.
    return { records, parsed, tail: pending.toString("utf8") };
  } catch {
    return { records, parsed, tail: "", failed: true };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function recordsFor(
  file: string,
  provider: UsageProvider,
  unavailable: () => void,
): Promise<UsageRecord[]> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    unavailable();
    return [];
  }
  const cacheKey = JSON.stringify([provider, file]);
  const cached = fileCache.get(cacheKey);
  const sameFile = cached && cached.dev === stat.dev && cached.ino === stat.ino;
  if (sameFile && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.records.concat(cached.tailRecords);
  }
  /*
   * Resume where the last scan stopped, unless the file is now smaller than
   * what was read from it — rotated or rewritten, so the old records are no
   * longer this file's and the whole thing is read again.
   */
  const from = sameFile && stat.size > cached.size ? cached.parsed : 0;
  const previous = from > 0 && cached ? cached.records : [];
  const state = from > 0 && cached ? { ...cached.state } : newCodexScanState();
  const parse = (line: string, scanState = state) => provider === "claude" ? parseClaudeLine(line)
    : parseCodexLine(line, path.basename(file, ".jsonl"), scanState);
  const { records: added, parsed, tail, failed } = await parseFrom(file, from, parse, stat);
  const records = previous.length === 0 ? added : previous.concat(added);
  // Valid unterminated JSON is visible, but stays provisional. Reparse it on
  // append without caching either its record or model context as committed.
  const tailRecord = tail ? parse(tail, { ...state }) : undefined;
  const tailRecords = tailRecord ? [tailRecord] : [];
  if (failed) {
    unavailable();
    // Retry from a known complete read; don't cache a failed read as success.
    fileCache.delete(cacheKey);
  } else cacheFile(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, dev: stat.dev, ino: stat.ino, parsed, records, tailRecords, state });
  return records.concat(tailRecords);
}

export async function collectUsageRecordsAsync(
  roots: UsageRoots,
  sinceMs?: number,
  onUnavailable: (provider: UsageProvider) => void = () => {},
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
  const claudeUnavailable = () => onUnavailable("claude");
  const codexUnavailable = () => onUnavailable("codex");
  for (const file of await transcriptFilesAsync(roots.claude, sinceMs, claudeUnavailable)) {
    append(await recordsFor(file, "claude", claudeUnavailable));
  }
  for (const file of await transcriptFilesAsync(roots.codex, sinceMs, codexUnavailable)) {
    append(await recordsFor(file, "codex", codexUnavailable));
  }
  return records;
}

export async function readUsageSummaryAsync(
  sinceMs?: number,
  roots = defaultUsageRoots(),
): Promise<UsageSummary> {
  const unavailable = new Set<UsageProvider>();
  const records = await collectUsageRecordsAsync(roots, sinceMs, (provider) => unavailable.add(provider));
  return { ...summarise(records, sinceMs), unavailableSources: [...unavailable] };
}

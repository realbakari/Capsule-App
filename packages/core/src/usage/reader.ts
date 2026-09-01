import fs from "node:fs";
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

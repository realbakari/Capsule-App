import { createId } from "@capsule/shared";
import type Database from "better-sqlite3";

/**
 * A thread's rows, moved or copied as whole rows.
 *
 * Restore parks the turns it removes and Redo puts them back; fork copies the
 * turns it keeps into a new thread. Both work on raw rows, table by table, so
 * a column added to any of these tables later travels with the turn without
 * this file knowing about it.
 */
export type TranscriptRows = Record<TranscriptTable, Array<Record<string, unknown>>>;

/** Insert order: a row's parent comes before it. */
const TABLES = ["runs", "contracts", "run_events", "artifacts", "approvals", "policy_decisions", "messages"] as const;
type TranscriptTable = (typeof TABLES)[number];

/** Which turns sit at or after a cut, and which before it. */
export interface TranscriptSplit {
  before: { messageIds: string[]; runIds: string[] };
  after: { messageIds: string[]; runIds: string[] };
}

/**
 * Split a thread at a message, by transcript position (created_at, then
 * rowid), the order the thread shows. Timestamps are millisecond-grained, so
 * a reply can share one with the next prompt; created_at alone cannot tell
 * them apart. A run belongs after the cut when any of its messages does, or
 * when it has none before the cut and started at or after it. With no cut,
 * everything is before.
 */
export function splitTranscript(sqlite: Database.Database, sessionId: string, cutMessageId?: string): TranscriptSplit {
  const messages = sqlite.prepare("SELECT id, run_id AS runId, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at, rowid")
    .all(sessionId) as Array<{ id: string; runId: string | null; createdAt: string }>;
  const runs = sqlite.prepare("SELECT id, created_at AS createdAt FROM runs WHERE session_id = ? ORDER BY created_at, rowid")
    .all(sessionId) as Array<{ id: string; createdAt: string }>;
  const cut = cutMessageId === undefined ? -1 : messages.findIndex((message) => message.id === cutMessageId);
  if (cut < 0) return { before: { messageIds: messages.map((m) => m.id), runIds: runs.map((r) => r.id) }, after: { messageIds: [], runIds: [] } };
  const kept = messages.slice(0, cut);
  const dropped = messages.slice(cut);
  const keptRuns = new Set(kept.flatMap((message) => (message.runId ? [message.runId] : [])));
  const droppedRuns = new Set(dropped.flatMap((message) => (message.runId ? [message.runId] : [])));
  const cutAt = dropped[0]!.createdAt;
  for (const run of runs) {
    if (!keptRuns.has(run.id) && run.createdAt >= cutAt) droppedRuns.add(run.id);
  }
  return {
    before: { messageIds: kept.map((m) => m.id), runIds: runs.filter((run) => !droppedRuns.has(run.id)).map((run) => run.id) },
    after: { messageIds: dropped.map((m) => m.id), runIds: runs.filter((run) => droppedRuns.has(run.id)).map((run) => run.id) },
  };
}

function keyFor(table: TranscriptTable, messageIds: string[], runIds: string[]): [string, string[]] {
  if (table === "messages") return ["id", messageIds];
  if (table === "runs") return ["id", runIds];
  return ["run_id", runIds];
}

function readRows(sqlite: Database.Database, messageIds: string[], runIds: string[]): TranscriptRows {
  const rows = {} as TranscriptRows;
  for (const table of TABLES) {
    const [column, ids] = keyFor(table, messageIds, runIds);
    const select = sqlite.prepare(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY rowid`);
    rows[table] = ids.flatMap((id) => select.all(id) as Array<Record<string, unknown>>);
  }
  return rows;
}

function insertRows(sqlite: Database.Database, rows: Partial<TranscriptRows>): void {
  for (const table of TABLES) {
    for (const row of rows[table] ?? []) {
      const columns = Object.keys(row);
      sqlite.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((name) => `@${name}`).join(", ")})`).run(row);
    }
  }
}

/** Take turns out of a thread, returning them whole so they can be put back. */
export function parkRows(sqlite: Database.Database, messageIds: string[], runIds: string[]): TranscriptRows {
  return sqlite.transaction(() => {
    const rows = readRows(sqlite, messageIds, runIds);
    for (const table of [...TABLES].reverse()) {
      const [column, ids] = keyFor(table, messageIds, runIds);
      const remove = sqlite.prepare(`DELETE FROM ${table} WHERE ${column} = ?`);
      for (const id of ids) remove.run(id);
    }
    return rows;
  })();
}

export function unparkRows(sqlite: Database.Database, rows: Partial<TranscriptRows>): void {
  sqlite.transaction(() => insertRows(sqlite, rows))();
}

export interface CopyTranscriptOptions {
  toSessionId: string;
  messageIds: string[];
  runIds: string[];
  /** The copy's checkpoint ref, given the original's and the copy's run id. */
  checkpointRef: (originalRef: string, copyRunId: string) => string;
  /** A fork into a new worktree records its turns against that folder. */
  workingDirectory?: string;
}

/**
 * Copy turns into another thread under new ids, keeping their timestamps so
 * the copy reads in the same order and a copied turn stays recognisably older
 * than the thread it was copied into. Returns original run id to copy.
 */
export function copyTranscript(sqlite: Database.Database, options: CopyTranscriptOptions): Map<string, string> {
  return sqlite.transaction(() => {
    const rows = readRows(sqlite, options.messageIds, options.runIds);
    const runIds = new Map(rows.runs.map((row) => [String(row.id), createId("run")]));
    const contractIds = new Map(rows.contracts.map((row) => [String(row.id), createId("contract")]));
    const run = (value: unknown) => (typeof value === "string" ? runIds.get(value) ?? value : value);
    insertRows(sqlite, {
      runs: rows.runs.map((row) => {
        const id = runIds.get(String(row.id))!;
        return {
          ...row,
          id,
          session_id: options.toSessionId,
          contract_id: typeof row.contract_id === "string" ? contractIds.get(row.contract_id) ?? row.contract_id : row.contract_id,
          checkpoint_ref: typeof row.checkpoint_ref === "string" ? options.checkpointRef(row.checkpoint_ref, id) : row.checkpoint_ref,
          ...(options.workingDirectory && row.working_directory ? { working_directory: options.workingDirectory } : {}),
        };
      }),
      contracts: rows.contracts.map((row) => ({ ...row, id: contractIds.get(String(row.id)), run_id: run(row.run_id) })),
      run_events: rows.run_events.map((row) => ({ ...row, id: createId("evt"), run_id: run(row.run_id) })),
      artifacts: rows.artifacts.map((row) => ({ ...row, id: createId("artifact"), run_id: run(row.run_id), session_id: options.toSessionId })),
      approvals: rows.approvals.map((row) => ({ ...row, id: createId("approval"), run_id: run(row.run_id) })),
      policy_decisions: rows.policy_decisions.map((row) => ({ ...row, id: createId("decision"), run_id: run(row.run_id) })),
      messages: rows.messages.map((row) => ({ ...row, id: createId("msg"), session_id: options.toSessionId, run_id: run(row.run_id) })),
    });
    return runIds;
  })();
}

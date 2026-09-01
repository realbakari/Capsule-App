/**
 * Token usage, read from the coding CLIs' own session transcripts.
 *
 * Capsule records nothing extra for this. The CLIs already write a JSONL
 * transcript per session, and reading those has three properties that
 * recording our own would not: usage from sessions run outside Capsule is
 * counted too (the CLIs are shared), history is available immediately rather
 * than from the day the feature ships, and the numbers are the provider's own
 * rather than our approximation of them.
 *
 * Parsers are pure and line-at-a-time so a caller can stream a large file
 * without materialising it. Nothing here touches the filesystem.
 */

export type UsageProvider = "claude" | "codex";

export interface TokenTotals {
  /** Input tokens billed at full rate. */
  input: number;
  /** Input served from cache, billed at a reduced rate. */
  cachedInput: number;
  /** Tokens written into the cache. */
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface UsageRecord {
  provider: UsageProvider;
  /** Epoch milliseconds. */
  at: number;
  model: string;
  sessionId: string;
  totals: TokenTotals;
  /**
   * Identifies the billed request, for de-duplication. Claude Code writes one
   * transcript line per content block of an assistant message, each repeating
   * that message's usage — in a sampled transcript, 1,259 usage lines carried
   * only 510 distinct messages, so summing lines overcounts by about 2.5x.
   */
  dedupeKey?: string;
}

export const EMPTY_TOTALS: TokenTotals = {
  input: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
};

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

export function totalTokens(totals: TokenTotals): number {
  return totals.input + totals.cachedInput + totals.cacheWrite + totals.output + totals.reasoning;
}

/** A count is only a count when it is a finite, non-negative number. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function millis(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * One line of a Claude Code transcript.
 *
 * Usage hangs off `message.usage`, with the model on `message.model` and the
 * timestamp at the top level. Assistant turns that used no tokens, and the
 * `<synthetic>` model Claude Code writes for locally generated messages, carry
 * no billable usage and are skipped rather than counted as zero-token rows.
 */
export function parseClaudeLine(line: string): UsageRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const row = asRecord(value);
  if (!row) return undefined;
  const message = asRecord(row.message);
  const usage = message ? asRecord(message.usage) : undefined;
  if (!usage) return undefined;

  const model = typeof message?.model === "string" ? message.model : "";
  if (!model || model === "<synthetic>") return undefined;

  // Claude's buckets are disjoint: cache reads and cache writes are counted
  // separately from input_tokens, which holds only the uncached remainder.
  // Verified against sampled transcripts, where input is routinely far smaller
  // than cache_read on the same line.
  const totals: TokenTotals = {
    input: count(usage.input_tokens),
    cachedInput: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    output: count(usage.output_tokens),
    reasoning: 0,
  };
  if (totalTokens(totals) === 0) return undefined;

  const messageId = typeof message?.id === "string" ? message.id : undefined;
  const requestId = typeof row.requestId === "string" ? row.requestId : undefined;

  return {
    provider: "claude",
    at: millis(row.timestamp) ?? 0,
    model,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : "",
    totals,
    dedupeKey: messageId ?? requestId,
  };
}

/**
 * One line of a Codex rollout transcript.
 *
 * Codex reports both `last_token_usage` (this turn) and `total_token_usage`
 * (the session so far) on the same line. Only the per-turn figure may be
 * summed: adding the running total on every line multiplies a session's usage
 * by roughly the number of turns in it.
 */
export function parseCodexLine(line: string, sessionId = ""): UsageRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const row = asRecord(value);
  if (!row) return undefined;
  const payload = asRecord(row.payload);
  const info = payload ? asRecord(payload.info) : undefined;
  const usage = info ? asRecord(info.last_token_usage) : undefined;
  if (!usage) return undefined;

  /*
   * Codex nests where Claude separates: cached_input_tokens is part of
   * input_tokens, and reasoning_output_tokens is part of output_tokens.
   * Verified on 4,671 sampled turns, where total_tokens equalled
   * input + output in 98.5% of them and reasoning never exceeded output.
   * Subtracting gives the same disjoint buckets Claude already reports, so a
   * total is a real sum rather than a double count.
   */
  const rawInput = count(usage.input_tokens);
  const cachedInput = Math.min(count(usage.cached_input_tokens), rawInput);
  const rawOutput = count(usage.output_tokens);
  const reasoning = Math.min(count(usage.reasoning_output_tokens), rawOutput);

  const totals: TokenTotals = {
    input: rawInput - cachedInput,
    cachedInput,
    cacheWrite: 0,
    output: rawOutput - reasoning,
    reasoning,
  };
  if (totalTokens(totals) === 0) return undefined;

  const model =
    (typeof info?.model === "string" && info.model) ||
    (typeof payload?.model === "string" && payload.model) ||
    "codex";

  return {
    provider: "codex",
    at: millis(row.timestamp) ?? 0,
    model,
    sessionId: typeof row.session_id === "string" ? row.session_id : sessionId,
    totals,
  };
}

/**
 * Sum records, dropping repeats of the same billed request.
 *
 * Keyed by provider and dedupeKey, so two providers cannot collide, and a
 * record without a key is always counted — those are inherently unique.
 */
export function sumRecords(records: Iterable<UsageRecord>): TokenTotals {
  const seen = new Set<string>();
  let totals = EMPTY_TOTALS;
  for (const record of records) {
    if (record.dedupeKey) {
      const key = `${record.provider}:${record.dedupeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    totals = addTotals(totals, record.totals);
  }
  return totals;
}

/** Records with repeats of the same billed request removed, order preserved. */
export function dedupe(records: Iterable<UsageRecord>): UsageRecord[] {
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const record of records) {
    if (record.dedupeKey) {
      const key = `${record.provider}:${record.dedupeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(record);
  }
  return out;
}

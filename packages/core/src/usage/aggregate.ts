import {
  addTotals,
  dedupe,
  EMPTY_TOTALS,
  totalTokens,
  type TokenTotals,
  type UsageProvider,
  type UsageRecord,
} from "./transcripts.js";

/**
 * Grouping for the usage view.
 *
 * Every function here de-duplicates first. A caller that groups raw records
 * would count Claude's repeated lines once per group, which is the same
 * overcount in a shape that is harder to notice.
 */

export interface UsageBucket {
  key: string;
  totals: TokenTotals;
  /** Distinct billed requests, not transcript lines. */
  requests: number;
}

export interface UsageSummary {
  totals: TokenTotals;
  requests: number;
  sessions: number;
  byDay: UsageBucket[];
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  /** Bounds of the data actually found, or undefined when there is none. */
  from?: number;
  to?: number;
}

function group(records: UsageRecord[], keyOf: (record: UsageRecord) => string): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();
  for (const record of records) {
    const key = keyOf(record);
    const bucket = buckets.get(key) ?? { key, totals: EMPTY_TOTALS, requests: 0 };
    bucket.totals = addTotals(bucket.totals, record.totals);
    bucket.requests += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

/** ISO day in local time, so "today" means the user's today. */
export function dayKey(at: number): string {
  const date = new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function summarise(input: Iterable<UsageRecord>, since?: number): UsageSummary {
  const records = dedupe(input).filter((record) => (since ? record.at >= since : true));

  if (records.length === 0) {
    return {
      totals: EMPTY_TOTALS,
      requests: 0,
      sessions: 0,
      byDay: [],
      byProvider: [],
      byModel: [],
    };
  }

  const times = records.map((record) => record.at).filter((at) => at > 0);
  return {
    totals: records.reduce((acc, record) => addTotals(acc, record.totals), EMPTY_TOTALS),
    requests: records.length,
    sessions: new Set(records.map((record) => `${record.provider}:${record.sessionId}`)).size,
    // Days ascend so a chart reads left to right; the others lead with the
    // largest, which is the question being asked of them.
    byDay: group(records, (record) => dayKey(record.at)).sort((a, b) => a.key.localeCompare(b.key)),
    byProvider: group(records, (record) => record.provider).sort(
      (a, b) => totalTokens(b.totals) - totalTokens(a.totals),
    ),
    byModel: group(records, (record) => record.model).sort(
      (a, b) => totalTokens(b.totals) - totalTokens(a.totals),
    ),
    from: times.length > 0 ? Math.min(...times) : undefined,
    to: times.length > 0 ? Math.max(...times) : undefined,
  };
}

/** Epoch ms for "n days ago, from the start of that day". */
export function sinceDaysAgo(days: number, now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date.getTime();
}

export type { UsageProvider };

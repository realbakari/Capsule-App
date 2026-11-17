import { formatResetTime } from "@capsule/shared";

/** The main process's transcript summary, as the renderer receives it. */
export interface UsageBucket {
  key: string;
  totals: Record<string, number>;
  requests: number;
}

export interface UsageSummary {
  unavailableSources?: string[];
  totals: Record<string, number>;
  requests: number;
  sessions: number;
  byDay: UsageBucket[];
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  from?: number;
  to?: number;
}

/**
 * The main process counts a range from local midnight `days - 1` days ago,
 * so the one-day range is today, not the last 24 hours.
 */
export const USAGE_RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export const PROVIDER_LABELS: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

/** Disjoint buckets, so their sum is the processed total. Cache reads lead because they usually dominate. */
export const TOKEN_TYPES = [
  { key: "cachedInput", label: "Cache reads" },
  { key: "input", label: "Fresh input" },
  { key: "cacheWrite", label: "Cache writes" },
  { key: "output", label: "Output" },
  { key: "reasoning", label: "Reasoning" },
] as const;

export function compactTokens(value: number): string {
  if (value >= 1_000_000_000) return `${+(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function bucketTokens(totals: Record<string, number>): number {
  return Object.values(totals).reduce((acc, value) => acc + value, 0);
}

/** Never "0%" for something that happened: a sliver is not nothing. */
export function share(value: number, total: number): string {
  if (total <= 0 || value <= 0) return "0%";
  const percent = (value / total) * 100;
  if (percent < 0.1) return "<0.1%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** ISO day in local time, matching the main process's day keys. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

export function shortDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface DayPoint {
  key: string;
  tokens: number;
  requests: number;
}

/**
 * Every day in the range, idle ones included.
 *
 * The summary lists only days that had activity. Drawn as is, five busy days
 * in a 30-day range spread across the whole width and read as five weeks.
 */
export function dailySeries(byDay: readonly UsageBucket[], days: number, now = Date.now()): DayPoint[] {
  const found = new Map(byDay.map((bucket) => [bucket.key, bucket]));
  const points: DayPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = dayKey(date.getTime());
    const bucket = found.get(key);
    points.push({ key, tokens: bucket ? bucketTokens(bucket.totals) : 0, requests: bucket?.requests ?? 0 });
  }
  return points;
}

/** The smallest 1, 2, 2.5 or 5 × 10ⁿ at or above `peak`, so axis ticks are round. */
export function niceCeiling(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= peak) return step * magnitude;
  return 10 * magnitude;
}

export type LimitTone = "ok" | "near" | "over";

/** Warn only when it is actionable, as the context meter does. */
export function limitTone(usedPercent: number): LimitTone {
  if (usedPercent >= 100) return "over";
  if (usedPercent >= 80) return "near";
  return "ok";
}

/** Where even use across the window would be now, as a percent of the window. */
export function pacePercent(resetsAtMs: number, durationMins: number, now: number): number | undefined {
  const duration = durationMins * 60_000;
  const remaining = resetsAtMs - now;
  if (duration <= 0 || remaining <= 0 || remaining > duration) return undefined;
  return Math.round(((duration - remaining) / duration) * 100);
}

export function countdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${`${rest}`.padStart(2, "0")}m`;
  return `${rest}m`;
}

export function resetText(resetsAtMs: number, now: number): string {
  if (resetsAtMs <= now) return "Reset time passed; awaiting a new report";
  return `Resets in ${countdown(resetsAtMs - now)} · ${formatResetTime(new Date(resetsAtMs), new Date(now))}`;
}

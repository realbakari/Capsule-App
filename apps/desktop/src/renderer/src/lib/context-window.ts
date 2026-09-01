/**
 * Context-window usage, read from the activity Capsule already receives.
 *
 * ACP status frames carry lines like "usage updated: 87690/200000". Those were
 * classified as activity and shown as raw text, which is both unreadable and a
 * waste: it is exactly the pair a context meter needs, and the alternative —
 * asking the harness for it — does not exist over this transport.
 */

export interface ContextUsage {
  used: number;
  limit: number;
  /** 0–1. Clamped, because a provider may report over its own limit. */
  fraction: number;
}

// Tolerant of spacing and an optional colon, since the wording is the
// harness's and not a contract we control.
const USAGE = /usage\s+updated:?\s*(\d[\d,_]*)\s*\/\s*(\d[\d,_]*)/i;

function digits(value: string): number {
  return Number(value.replaceAll(",", "").replaceAll("_", ""));
}

export function parseContextUsage(text: string | undefined): ContextUsage | undefined {
  if (!text) return undefined;
  const match = USAGE.exec(text);
  if (!match?.[1] || !match[2]) return undefined;
  const used = digits(match[1]);
  const limit = digits(match[2]);
  // A zero or missing limit is a ratio nobody can render.
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return undefined;
  return { used, limit, fraction: Math.min(1, Math.max(0, used / limit)) };
}

/**
 * The most recent reading in a list of activity lines.
 *
 * Frames arrive in order and the last one is current, so this scans backwards
 * and stops at the first hit rather than parsing every line.
 */
export function latestContextUsage(lines: ReadonlyArray<string | undefined>): ContextUsage | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const usage = parseContextUsage(lines[index]);
    if (usage) return usage;
  }
  return undefined;
}

/** Compact "24k / 200k" for the meter's label. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/**
 * Warn only when it is actionable. A meter that turns red at half full trains
 * people to ignore it.
 */
export function contextTone(fraction: number): "normal" | "warn" | "critical" {
  if (fraction >= 0.9) return "critical";
  if (fraction >= 0.75) return "warn";
  return "normal";
}

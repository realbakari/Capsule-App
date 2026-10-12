/**
 * A turn that stopped because the provider is out of allowance. Capsule's
 * routes do not receive structured limit windows, so this reads the words
 * the agent used and, when they name a time, when the limit lifts.
 */

export interface UsageLimit {
  limited: boolean;
  /** When the provider said the allowance returns, if it said. */
  resetsAt?: Date;
}

const LIMIT = /rate limit|usage limit|session limit|quota|too many requests|limit (?:reached|exceeded)|out of (?:credits|budget)/i;

const UNIT_MS: Record<string, number> = { second: 1_000, sec: 1_000, s: 1_000, minute: 60_000, min: 60_000, m: 60_000, hour: 3_600_000, hr: 3_600_000, h: 3_600_000, day: 86_400_000, d: 86_400_000 };
/** Longest spelling first, or "h" would win over "hours" and drop the rest. */
const UNIT = "seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d";

function unitMs(raw: string | undefined): number {
  const unit = (raw ?? "s").toLowerCase();
  return UNIT_MS[unit] ?? UNIT_MS[unit.replace(/s$/, "")] ?? 1_000;
}

function relative(text: string, now: Date): Date | undefined {
  const match = new RegExp(`(?:try again|retry|resets?|available|back)\\s+(?:again\\s+)?(?:in|after)\\s+((?:\\d+\\s*(?:${UNIT})\\b\\s*(?:and\\s+)?)+)`, "i").exec(text)
    ?? /retry-after:?\s*(\d+)\s*(?:s|seconds?)?/i.exec(text);
  if (!match) return undefined;
  let total = 0;
  for (const part of match[1]!.matchAll(new RegExp(`(\\d+)\\s*(${UNIT})?\\b`, "gi"))) {
    total += Number(part[1]) * unitMs(part[2]);
  }
  return total > 0 ? new Date(now.getTime() + total) : undefined;
}

function absolute(text: string, now: Date): Date | undefined {
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(text);
  if (iso) {
    const date = new Date(iso[1]!);
    if (!Number.isNaN(date.getTime()) && date.getTime() > now.getTime()) return date;
  }
  const clock = /(?:resets?|available|back|until|at)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!clock) return undefined;
  let hours = Number(clock[1]);
  const minutes = Number(clock[2] ?? "0");
  const meridiem = clock[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  // A clock time already behind us means tomorrow.
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return date;
}

export function detectUsageLimit(error: string | undefined, now = new Date()): UsageLimit {
  const text = (error ?? "").trim();
  if (!text || !LIMIT.test(text)) return { limited: false };
  const resetsAt = relative(text, now) ?? absolute(text, now);
  return resetsAt ? { limited: true, resetsAt } : { limited: true };
}

export function formatResetTime(at: Date, now = new Date()): string {
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

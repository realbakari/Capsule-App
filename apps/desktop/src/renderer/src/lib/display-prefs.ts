import type { DiffFileState, DiffLayout, TimeFormat, ToolCallDisplay } from "@capsule/shared";

/**
 * Display preferences that many small, memoized components read: message
 * times, tool-call groups, diff files. The workspace writes them whenever
 * settings change; components read them when they render or mount, so a
 * component does not need the whole workspace to format a time.
 */
export interface DisplayPrefs {
  timeFormat: TimeFormat;
  toolCallDisplay: ToolCallDisplay;
  diffLayout: DiffLayout;
  diffFileState: DiffFileState;
}

let current: DisplayPrefs = { timeFormat: "system", toolCallDisplay: "compact", diffLayout: "split", diffFileState: "expanded" };

export function setDisplayPrefs(next: Partial<DisplayPrefs>): void {
  current = { ...current, ...next };
}

export function displayPrefs(): DisplayPrefs {
  return current;
}

/** A clock time in the chosen style: the system's own, or forced 12- or 24-hour. */
export function formatClock(value: string | number | Date, format: TimeFormat = current.timeFormat): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (format === "12h") options.hour12 = true;
  if (format === "24h") { options.hour12 = false; options.hour = "2-digit"; }
  return date.toLocaleTimeString([], options);
}

function dayNumber(date: Date): number {
  // Calendar days, not 24-hour spans, so a daylight-saving change cannot make yesterday today.
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/**
 * A clock time with the day it belongs to once that is not today: "10:42",
 * "Yesterday 10:42", "Mon 10:42" within the week, then a short date. A thread
 * read days later otherwise showed a column of bare times with no day at all.
 */
export function formatStamp(value: string | number | Date, now: number | Date = Date.now(), format: TimeFormat = current.timeFormat): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = formatClock(date, format);
  const today = now instanceof Date ? now : new Date(now);
  const days = dayNumber(today) - dayNumber(date);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
  return `${day}, ${time}`;
}

/** The whole date and time, for a tooltip under a short stamp. */
export function formatFullStamp(value: string | number | Date, format: TimeFormat = current.timeFormat): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ${formatClock(date, format)}`;
}

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
